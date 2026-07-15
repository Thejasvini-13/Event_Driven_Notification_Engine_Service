import Redis from 'ioredis';
import { createHash } from 'crypto';
import { logger } from '../server';

// ─── Redis Client ─────────────────────────────────────────────

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host:            process.env['REDIS_HOST']     ?? 'localhost',
      port:            parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
      password:        process.env['REDIS_PASSWORD'] || undefined,
      db:              parseInt(process.env['REDIS_DB'] ?? '0', 10),
      maxRetriesPerRequest: 3,
      retryStrategy:   (times: number) => Math.min(times * 50, 2000),
      enableReadyCheck: true,
      lazyConnect:     false,
    });

    redisClient.on('error', (err: Error) => {
      logger.error({ err }, 'Redis client error');
    });
    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('ready',   () => logger.info('Redis ready'));
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// ─── Idempotency Key ──────────────────────────────────────────

const IDEMPOTENCY_TTL_SECONDS = 3600; // 1-hour dedup window
const IDEMPOTENCY_PREFIX      = 'idem:';

/**
 * Compute a deterministic fingerprint from event_type + source_entity_id + truncated timestamp.
 * The timestamp is truncated to a 5-minute window so identical events within
 * that window are treated as duplicates.
 */
export function computeFingerprint(
  eventType:      string,
  sourceEntityId: string,
  timestampMs:    number,
): string {
  const windowMs   = 5 * 60 * 1000; // 5-minute window
  const windowedTs = Math.floor(timestampMs / windowMs) * windowMs;
  const raw        = `${eventType}:${sourceEntityId}:${windowedTs}`;
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Idempotency Layer ────────────────────────────────────────

export class IdempotencyService {
  private readonly redis: Redis;

  constructor() {
    this.redis = getRedis();
  }

  /**
   * Atomically check-and-set idempotency key using SET NX EX.
   * Returns true  → first-time processing (proceed)
   * Returns false → duplicate (skip)
   */
  async checkAndSet(
    eventType:      string,
    sourceEntityId: string,
    trackingId:     string,
    timestampMs:    number = Date.now(),
  ): Promise<boolean> {
    const fingerprint = computeFingerprint(eventType, sourceEntityId, timestampMs);
    const key         = `${IDEMPOTENCY_PREFIX}${fingerprint}`;

    // SET key trackingId NX EX ttl  (atomic: only set if not exists)
    const result = await this.redis.set(key, trackingId, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');

    if (result === null) {
      // Key already existed → duplicate
      const existingTrackingId = await this.redis.get(key);
      logger.warn(
        { eventType, sourceEntityId, fingerprint, existingTrackingId, newTrackingId: trackingId },
        'Idempotency duplicate detected — skipping',
      );
      return false;
    }

    logger.debug({ eventType, sourceEntityId, fingerprint }, 'Idempotency check passed');
    return true;
  }

  /**
   * Explicitly revoke an idempotency key (e.g., on permanent failure
   * so the event can be retried on next occurrence).
   */
  async revoke(
    eventType:      string,
    sourceEntityId: string,
    timestampMs:    number,
  ): Promise<void> {
    const fingerprint = computeFingerprint(eventType, sourceEntityId, timestampMs);
    const key         = `${IDEMPOTENCY_PREFIX}${fingerprint}`;
    await this.redis.del(key);
    logger.debug({ fingerprint }, 'Idempotency key revoked');
  }

  /**
   * Check without writing — useful for status queries.
   */
  async isDuplicate(
    eventType:      string,
    sourceEntityId: string,
    timestampMs:    number,
  ): Promise<boolean> {
    const fingerprint = computeFingerprint(eventType, sourceEntityId, timestampMs);
    const key         = `${IDEMPOTENCY_PREFIX}${fingerprint}`;
    const value       = await this.redis.get(key);
    return value !== null;
  }
}
