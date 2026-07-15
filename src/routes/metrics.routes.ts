import { Router, Request, Response } from 'express';
import { getKafkaClients } from '../config/kafka-rabbitmq';
import { logger } from '../server';

export const metricsRouter = Router();

// ─── Metric Stores ────────────────────────────────────────────

interface Counter {
  labels: Record<string, string>;
  value:  number;
}

interface HistogramBucket {
  le:    string;
  value: number;
}

interface Histogram {
  labels: Record<string, string>;
  sum:    number;
  count:  number;
  buckets: HistogramBucket[];
}

class MetricStore {
  private counters   = new Map<string, Counter[]>();
  private histograms = new Map<string, Histogram[]>();
  private gauges     = new Map<string, number>();

  incCounter(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key     = name;
    const entries = this.counters.get(key) ?? [];
    const labelKey = JSON.stringify(labels);
    const existing = entries.find(e => JSON.stringify(e.labels) === labelKey);
    if (existing) {
      existing.value += by;
    } else {
      entries.push({ labels, value: by });
    }
    this.counters.set(key, entries);
  }

  observeHistogram(
    name:    string,
    labels:  Record<string, string>,
    value:   number,
    bucketBoundaries: number[],
  ): void {
    const key     = name;
    const entries = this.histograms.get(key) ?? [];
    const labelKey = JSON.stringify(labels);
    const existing = entries.find(e => JSON.stringify(e.labels) === labelKey);

    const buckets = bucketBoundaries.map(le => ({
      le:    String(le),
      value: value <= le ? 1 : 0,
    }));
    buckets.push({ le: '+Inf', value: 1 });

    if (existing) {
      existing.sum   += value;
      existing.count += 1;
      existing.buckets.forEach((b, i) => {
        if (i < buckets.length && value <= parseFloat(b.le === '+Inf' ? Infinity.toString() : b.le)) {
          b.value++;
        }
      });
    } else {
      entries.push({ labels, sum: value, count: 1, buckets });
    }
    this.histograms.set(key, entries);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  toPrometheusText(): string {
    const lines: string[] = [];

    // Counters
    for (const [name, entries] of this.counters) {
      lines.push(`# HELP ${name} Notification engine counter`);
      lines.push(`# TYPE ${name} counter`);
      for (const entry of entries) {
        const labelStr = Object.entries(entry.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${name}{${labelStr}} ${entry.value}`);
      }
    }

    // Histograms
    for (const [name, entries] of this.histograms) {
      lines.push(`# HELP ${name} Notification engine latency histogram`);
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of entries) {
        const baseLabel = Object.entries(entry.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        for (const bucket of entry.buckets) {
          const leLabel = baseLabel ? `${baseLabel},le="${bucket.le}"` : `le="${bucket.le}"`;
          lines.push(`${name}_bucket{${leLabel}} ${bucket.value}`);
        }
        lines.push(`${name}_sum{${baseLabel}} ${entry.sum}`);
        lines.push(`${name}_count{${baseLabel}} ${entry.count}`);
      }
    }

    // Gauges
    for (const [name, value] of this.gauges) {
      lines.push(`# HELP ${name} Notification engine gauge`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    return lines.join('\n') + '\n';
  }
}

// ─── Singleton Metric Registry ────────────────────────────────

class PrometheusRegistry {
  private readonly store = new MetricStore();
  private readonly prefix: string;

  constructor() {
    this.prefix = process.env['METRICS_PREFIX'] ?? 'notif_engine';
  }

  counter(name: string): { inc: (labels?: Record<string, string>, by?: number) => void } {
    const fullName = `${this.prefix}_${name}`;
    return {
      inc: (labels: Record<string, string> = {}, by = 1) => {
        this.store.incCounter(fullName, labels, by);
      },
    };
  }

  histogram(name: string, boundaries: number[] = [10, 50, 100, 250, 500, 1000, 2500, 5000]) {
    const fullName = `${this.prefix}_${name}`;
    return {
      observe: (labels: Record<string, string>, value: number) => {
        this.store.observeHistogram(fullName, labels, value, boundaries);
      },
    };
  }

  gauge(name: string): { set: (value: number) => void } {
    const fullName = `${this.prefix}_${name}`;
    return {
      set: (value: number) => {
        this.store.setGauge(fullName, value);
      },
    };
  }

  getPrometheusText(): string {
    return this.store.toPrometheusText();
  }
}

// ─── Exported Metric Instances ────────────────────────────────

export const registry = new PrometheusRegistry();

export const notificationsReceivedTotal = registry.counter('notifications_received_total');
export const notificationsFailedTotal   = registry.counter('notifications_failed_total');
export const notificationsDeliveredTotal = registry.counter('notifications_delivered_total');
export const deliveryLatencyHistogram   = registry.histogram('delivery_latency_ms', [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
export const consumerLagGauge          = registry.gauge('kafka_consumer_lag');
export const circuitBreakerStateGauge  = registry.gauge('circuit_breaker_open_total');

// ─── GET /metrics ─────────────────────────────────────────────

metricsRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  // Fetch live consumer lag from Kafka admin
  try {
    const { admin, criticalConsumer: _, standardConsumer: __ } = getKafkaClients();
    const topicCritical = process.env['KAFKA_TOPIC_CRITICAL'] ?? 'fin-events-critical';
    const topicStandard = process.env['KAFKA_TOPIC_STANDARD'] ?? 'fin-events-standard';

    const [criticalOffsets, standardOffsets] = await Promise.all([
      admin.fetchTopicOffsets(topicCritical),
      admin.fetchTopicOffsets(topicStandard),
    ]);

    const totalLag = [...criticalOffsets, ...standardOffsets].reduce((sum, partition) => {
      return sum + (parseInt(partition.high, 10) - parseInt(partition.low, 10));
    }, 0);

    consumerLagGauge.set(totalLag);
  } catch (err) {
    logger.debug({ err }, 'Could not fetch Kafka consumer lag for metrics');
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(registry.getPrometheusText());
});
