import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// ─── Logger (must be created before importing modules that use it) ───

export const logger = pino({
  level:     process.env['LOG_LEVEL'] ?? 'info',
  transport: process.env['NODE_ENV'] !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
});

// ─── Late imports (depend on logger) ─────────────────────────

import { initializeKafka, shutdownKafka, parseKafkaMessage, publishToKafka } from './config/kafka-rabbitmq';
import { initializeRabbitMQ, shutdownRabbitMQ, publishToQueue, consumeQueue } from './config/kafka-rabbitmq';
import { getPool, closePool } from './config/database';
import { getRedis, closeRedis } from './core/idempotency';
import { apiRouter } from './routes/api.routes';
import { metricsRouter } from './routes/metrics.routes';
import { notificationsDeliveredTotal, notificationsFailedTotal, deliveryLatencyHistogram } from './routes/metrics.routes';
import { NotificationStateMachine } from './core/state-machine';
import { TemplateRenderer } from './templates/template.renderer';
import { DndScrubber } from './core/dnd-scrubber';
import { SmsProvider }       from './providers/sms.provider';
import { EmailProvider }     from './providers/email.provider';
import { PushProvider }      from './providers/push.provider';
import { WhatsAppProvider }  from './providers/whatsapp.provider';
import { InAppProvider }     from './providers/inapp.provider';
import { query, withTransaction } from './config/database';
import type { KafkaEventMessage } from './config/kafka-rabbitmq';
import type { SendPayload }       from './interfaces/provider.interface';

// ─── WebSocket Broadcaster ────────────────────────────────────

export class WebSocketBroadcaster {
  private static clients = new Map<string, Set<WebSocket>>();

  static register(userId: string, ws: WebSocket): void {
    if (!WebSocketBroadcaster.clients.has(userId)) {
      WebSocketBroadcaster.clients.set(userId, new Set());
    }
    WebSocketBroadcaster.clients.get(userId)!.add(ws);
  }

  static deregister(userId: string, ws: WebSocket): void {
    WebSocketBroadcaster.clients.get(userId)?.delete(ws);
  }

  static broadcast(userId: string, message: string): boolean {
    const userSockets = WebSocketBroadcaster.clients.get(userId);
    if (!userSockets || userSockets.size === 0) return false;

    let sent = false;
    for (const ws of userSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        sent = true;
      }
    }
    return sent;
  }

  static broadcastAll(message: string): void {
    for (const sockets of WebSocketBroadcaster.clients.values()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    }
  }

  static getConnectedCount(): number {
    let count = 0;
    for (const sockets of WebSocketBroadcaster.clients.values()) {
      count += sockets.size;
    }
    return count;
  }
}

// ─── Provider Registry ────────────────────────────────────────

const providers = {
  SMS:      new SmsProvider(),
  EMAIL:    new EmailProvider(),
  PUSH:     new PushProvider(),
  WHATSAPP: new WhatsAppProvider(),
  INAPP:    new InAppProvider(),
} as const;

type ChannelKey = keyof typeof providers;

const renderer = new TemplateRenderer();

// ─── Core Event Processor ────────────────────────────────────

async function processKafkaEvent(event: KafkaEventMessage): Promise<void> {
  const trackingId = event.trackingId;
  const childLog   = logger.child({ trackingId, eventType: event.eventType });

  childLog.info('Processing Kafka event');

  // Fetch user + preferences from DB
  const userResult = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.timezone, u.locale,
            u.fcm_token, u.whatsapp_optin, u.is_dnd_registered
     FROM users u WHERE u.id = $1`,
    [event.userId],
  );

  if (userResult.rowCount === 0) {
    childLog.warn({ userId: event.userId }, 'User not found — dropping event');
    return;
  }
  const user = userResult.rows[0];

  const prefsResult = await query(
    'SELECT channel, is_enabled FROM user_preferences WHERE user_id = $1 AND is_enabled = TRUE',
    [user.id],
  );
  const enabledChannels = new Set(
    prefsResult.rows.map((r) => (r['channel'] as string) as ChannelKey),
  );

  const channels = (event.channels ?? Object.keys(providers)) as ChannelKey[];
  const category = DndScrubber.resolveCategory(event.eventType);

  for (const channel of channels) {
    if (!enabledChannels.has(channel)) {
      childLog.info({ channel }, 'Channel disabled by user preferences — skipping');
      continue;
    }

    const provider = providers[channel];
    if (!provider) {
      childLog.warn({ channel }, 'Unknown channel — skipping');
      continue;
    }

    // Determine recipient
    let recipient = '';
    switch (channel) {
      case 'SMS':      recipient = user.phone;      break;
      case 'EMAIL':    recipient = user.email;      break;
      case 'PUSH':     recipient = user.fcm_token ?? 'mock_fcm_token_sandbox'; break;
      case 'WHATSAPP': recipient = user.whatsapp_optin ? user.phone : ''; break;
      case 'INAPP':    recipient = user.id;         break;
    }

    if (!recipient) {
      childLog.info({ channel }, 'No valid recipient for channel — skipping');
      continue;
    }

    // Render template
    const { subject, body } = renderer.render(
      event.eventType,
      event.locale ?? user.locale,
      event.payload as Record<string, unknown>,
      channel,
    );

    // Create notification record in DB (CREATED state)
    const notifInsert = await withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO notifications
           (tracking_id, user_id, event_type, category, channel, status, priority,
            template_id, subject, body, personalisation_data, source_entity_id,
            idempotency_key, metadata)
         VALUES ($1, $2, $3, $4, $5, 'CREATED', $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          trackingId,
          user.id,
          event.eventType,
          category,
          channel,
          event.priority ?? 5,
          event.eventType.toLowerCase().replace('-', '_'),
          subject,
          body,
          JSON.stringify(event.payload),
          event.sourceEntityId,
          `${event.eventType}:${event.sourceEntityId}:${channel}`,
          JSON.stringify({ trackingId, channel, locale: event.locale }),
        ],
      );
      await client.query(
        `INSERT INTO notification_state_log (notification_id, from_status, to_status, actor)
         VALUES ($1, NULL, 'CREATED', 'kafka-consumer')`,
        [result.rows[0]!.id],
      );
      return result.rows[0]!.id;
    });

    const notificationId = notifInsert;
    childLog.info({ notificationId, channel }, 'Notification record created');

    // Transition: CREATED → ENRICHED
    await NotificationStateMachine.transition({
      notificationId,
      fromStatus: 'CREATED',
      toStatus:   'ENRICHED',
      actor:      'enrichment-service',
      metadata:   { locale: event.locale, templateId: event.eventType },
    });

    // Transition: ENRICHED → ROUTED
    await NotificationStateMachine.transition({
      notificationId,
      fromStatus: 'ENRICHED',
      toStatus:   'ROUTED',
      actor:      'router',
      metadata:   { channel, provider: provider.channelName },
    });

    // Publish to RabbitMQ delivery queue
    const queueName = `notif.${channel.toLowerCase()}` as Parameters<typeof publishToQueue>[0];
    await publishToQueue(queueName, {
      notificationId,
      trackingId,
      eventType:      event.eventType,
      userId:         user.id,
      recipient,
      subject,
      body,
      channel,
      priority:       event.priority ?? 5,
      metadata: {
        priority:  event.priority ?? 5,
        locale:    event.locale,
        eventType: event.eventType,
      },
    }, { priority: event.priority ?? 5 });

    // Transition: ROUTED → QUEUED
    await NotificationStateMachine.transition({
      notificationId,
      fromStatus: 'ROUTED',
      toStatus:   'QUEUED',
      actor:      'rabbitmq-publisher',
      metadata:   { queue: queueName },
    });

    // Broadcast live update to UI via WebSocket
    WebSocketBroadcaster.broadcastAll(JSON.stringify({
      type:           'STATE_UPDATE',
      notificationId,
      trackingId,
      eventType:      event.eventType,
      channel,
      status:         'QUEUED',
      timestamp:      new Date().toISOString(),
      userName:       user.full_name,
    }));
  }
}

// ─── RabbitMQ Delivery Consumer ──────────────────────────────

async function startDeliveryConsumers(): Promise<void> {
  const channelQueueMap: Array<[ChannelKey, Parameters<typeof consumeQueue>[0]]> = [
    ['SMS',      'notif.sms'],
    ['EMAIL',    'notif.email'],
    ['PUSH',     'notif.push'],
    ['WHATSAPP', 'notif.whatsapp'],
    ['INAPP',    'notif.inapp'],
  ];

  for (const [channel, queue] of channelQueueMap) {
    await consumeQueue(queue, async (msg) => {
      const payload = JSON.parse(msg.content.toString()) as {
        notificationId: string;
        trackingId:     string;
        userId:         string;
        recipient:      string;
        subject:        string;
        body:           string;
        channel:        string;
        priority:       number;
        metadata:       Record<string, unknown>;
      };

      const childLog = logger.child({
        trackingId:     payload.trackingId,
        notificationId: payload.notificationId,
        channel,
      });

      childLog.info('Delivering notification');

      const sendPayload: SendPayload = {
        notificationId: payload.notificationId,
        trackingId:     payload.trackingId,
        userId:         payload.userId,
        recipient:      payload.recipient,
        subject:        payload.subject,
        body:           payload.body,
        metadata:       payload.metadata,
      };

      const provider = providers[channel as ChannelKey];
      if (!provider) {
        childLog.warn({ channel }, 'No provider registered for channel');
        return;
      }

      const result = await provider.send(sendPayload);

      if (result.success) {
        // Update provider message ID and transition to SENT
        await query(
          'UPDATE notifications SET provider_message_id = $1, updated_at = NOW() WHERE id = $2',
          [result.providerMessageId, payload.notificationId],
        );

        await NotificationStateMachine.transition({
          notificationId: payload.notificationId,
          fromStatus:     'QUEUED',
          toStatus:       'SENT',
          actor:          `${channel.toLowerCase()}-provider`,
          metadata:       { providerMessageId: result.providerMessageId, latencyMs: result.latencyMs },
        });

        // Simulate delivery confirmation (async)
        setTimeout(async () => {
          try {
            await NotificationStateMachine.transition({
              notificationId: payload.notificationId,
              fromStatus:     'SENT',
              toStatus:       'DELIVERED',
              actor:          'delivery-webhook',
              metadata:       { providerMessageId: result.providerMessageId },
            });

            notificationsDeliveredTotal.inc({ channel, event_type: payload.metadata['eventType'] as string ?? '' });
            deliveryLatencyHistogram.observe({ channel }, result.latencyMs);

            WebSocketBroadcaster.broadcastAll(JSON.stringify({
              type:           'STATE_UPDATE',
              notificationId: payload.notificationId,
              trackingId:     payload.trackingId,
              channel,
              status:         'DELIVERED',
              timestamp:      new Date().toISOString(),
            }));

            childLog.info('Notification delivered');
          } catch (err) {
            childLog.error({ err }, 'Failed to transition to DELIVERED');
          }
        }, 1000 + Math.random() * 2000);

      } else {
        // Record failure
        await query(
          'UPDATE notifications SET error_message = $1, retry_count = retry_count + 1, updated_at = NOW() WHERE id = $2',
          [result.errorMessage, payload.notificationId],
        );

        notificationsFailedTotal.inc({ channel, reason: result.errorCode ?? 'unknown' });

        // Check if max retries exceeded
        const retryResult = await query<{ retry_count: number; max_retries: number }>(
          'SELECT retry_count, max_retries FROM notifications WHERE id = $1',
          [payload.notificationId],
        );
        const { retry_count, max_retries } = retryResult.rows[0] ?? { retry_count: 0, max_retries: 3 };

        if (retry_count >= max_retries) {
          // Dead letter
          await query(
            `INSERT INTO dead_letter_queue
               (notification_id, tracking_id, event_type, channel, original_payload, error_message, retry_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              payload.notificationId,
              payload.trackingId,
              payload.metadata['eventType'],
              channel,
              JSON.stringify(payload),
              result.errorMessage,
              retry_count,
            ],
          );
          await NotificationStateMachine.transition({
            notificationId: payload.notificationId,
            fromStatus:     'QUEUED',
            toStatus:       'FAILED',
            reason:         result.errorMessage,
          });
          childLog.error({ retryCount: retry_count }, 'Max retries exceeded — dead lettered');
        } else {
          childLog.warn({ retryCount: retry_count, maxRetries: max_retries }, 'Delivery failed — will retry');
          throw new Error(result.errorMessage ?? 'Delivery failed'); // nack to RabbitMQ for retry
        }
      }
    });

    logger.info({ channel, queue }, 'Delivery consumer started');
  }
}

// ─── Express App ──────────────────────────────────────────────

export async function createApp(): Promise<{ app: express.Application; server: http.Server }> {
  const app = express();

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({
    origin:      process.env['NODE_ENV'] === 'production' ? false : '*',
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  // Routes
  app.use('/api', apiRouter);
  app.use('/metrics', metricsRouter);

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error({ err }, 'Unhandled express error');
    res.status(500).json({
      error:     'Internal server error',
      requestId: uuidv4(),
    });
  });

  const server = http.createServer(app);

  // ── WebSocket Server ──────────────────────────────────────
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const userId = new URL(req.url ?? '/', `http://localhost`).searchParams.get('userId') ?? 'anonymous';
    WebSocketBroadcaster.register(userId, ws);

    logger.info({ userId, connectedClients: WebSocketBroadcaster.getConnectedCount() }, 'WebSocket client connected');

    ws.send(JSON.stringify({ type: 'CONNECTED', userId, timestamp: new Date().toISOString() }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; notificationId?: string };
        if (msg.type === 'READ' && msg.notificationId) {
          // Handle read receipt
          NotificationStateMachine.getCurrentStatus(msg.notificationId).then(async (status) => {
            if (status === 'DELIVERED') {
              await NotificationStateMachine.transition({
                notificationId: msg.notificationId!,
                fromStatus:     'DELIVERED',
                toStatus:       'READ',
                actor:          `user:${userId}`,
              });
            }
          }).catch(err => logger.error({ err }, 'Read receipt handling failed'));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      WebSocketBroadcaster.deregister(userId, ws);
      logger.debug({ userId }, 'WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.warn({ err, userId }, 'WebSocket error');
      WebSocketBroadcaster.deregister(userId, ws);
    });
  });

  return { app, server };
}

// ─── Bootstrap ───────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('Starting Notification Engine...');

  // Initialize infrastructure connections
  await initializeKafka();
  await initializeRabbitMQ();

  // Warm up DB pool
  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('Database connection pool ready');

  // Warm up Redis
  getRedis();

  // Start Kafka consumers
  const { criticalConsumer, standardConsumer } = (await import('./config/kafka-rabbitmq')).getKafkaClients();

  await criticalConsumer.run({
    eachMessage: async ({ message, partition, topic }) => {
      const event = parseKafkaMessage(message);
      if (!event) return;

      logger.info(
        { topic, partition, trackingId: event.trackingId, offset: message.offset },
        'Critical Kafka message received',
      );

      try {
        await processKafkaEvent(event);
      } catch (err) {
        logger.error({ err, trackingId: event.trackingId }, 'Failed to process critical event');
        // Publish to DLQ topic
        await publishToKafka(
          process.env['KAFKA_TOPIC_DLQ'] ?? 'fin-events-dlq',
          { ...event, payload: { ...event.payload, _error: String(err) } },
        );
      }
    },
  });

  await standardConsumer.run({
    eachMessage: async ({ message, partition, topic }) => {
      const event = parseKafkaMessage(message);
      if (!event) return;

      logger.info(
        { topic, partition, trackingId: event.trackingId, offset: message.offset },
        'Standard Kafka message received',
      );

      try {
        await processKafkaEvent(event);
      } catch (err) {
        logger.error({ err, trackingId: event.trackingId }, 'Failed to process standard event');
        await publishToKafka(
          process.env['KAFKA_TOPIC_DLQ'] ?? 'fin-events-dlq',
          { ...event, payload: { ...event.payload, _error: String(err) } },
        );
      }
    },
  });

  // Start RabbitMQ delivery consumers
  await startDeliveryConsumers();

  // Start HTTP server
  const { server } = await createApp();
  const port = parseInt(process.env['PORT'] ?? '3000', 10);

  server.listen(port, () => {
    logger.info(
      {
        port,
        env:       process.env['NODE_ENV'] ?? 'development',
        metricsUrl: `http://localhost:${port}/metrics`,
        apiUrl:    `http://localhost:${port}/api`,
        wsUrl:     `ws://localhost:${port}/ws`,
      },
      '🚀 Notification Engine started',
    );
  });

  // ── Graceful Shutdown ─────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutting down gracefully...');

    server.close(async () => {
      await shutdownKafka();
      await shutdownRabbitMQ();
      await closePool();
      await closeRedis();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force exit after 30s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000).unref();
  }

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
    void shutdown('unhandledRejection');
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Bootstrap failed');
  process.exit(1);
});
