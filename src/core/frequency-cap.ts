import { getRedis } from './idempotency';
import { logger } from '../server';

// ─── Category Limits Configuration ───────────────────────────

interface CategoryLimit {
  maxPerDay:  number;
  maxPerHour: number;
}

const CATEGORY_LIMITS: Readonly<Record<string, CategoryLimit>> = {
  TRANSACTIONAL: { maxPerDay: 50, maxPerHour: 20 },
  PROMOTIONAL:   { maxPerDay:  3, maxPerHour:  2 },
  ALERT:         { maxPerDay: 20, maxPerHour: 10 },
  REGULATORY:    { maxPerDay: 10, maxPerHour:  5 },
};

const GLOBAL_DAILY_LIMIT = parseInt(process.env['FREQ_CAP_GLOBAL_DAILY'] ?? '12', 10);
const FREQ_PREFIX        = 'fcap:';

// ─── Frequency Cap Result ─────────────────────────────────────

export interface FrequencyCapResult {
  allowed:      boolean;
  reason?:      string;
  globalCount?: number;
  catCount?:    number;
}

// ─── Sliding Window Algorithm ─────────────────────────────────

export class FrequencyCapService {
  /**
   * Redis sliding window using a sorted set.
   * Members: timestamp strings (unique by appending a random suffix).
   * Score:   epoch milliseconds.
   * Window:  last N milliseconds.
   */
  private async slidingWindowCount(
    key:       string,
    windowMs:  number,
    ttlSec:    number,
  ): Promise<number> {
    const redis = getRedis();
    const now   = Date.now();
    const from  = now - windowMs;

    const pipeline = redis.pipeline();
    // Remove expired members
    pipeline.zremrangebyscore(key, '-inf', from);
    // Count remaining members in window
    pipeline.zcard(key);
    // Set TTL to avoid orphan keys
    pipeline.expire(key, ttlSec);

    const results = await pipeline.exec();
    // zcard result is at index 1
    const cardResult = results?.[1];
    if (cardResult && cardResult[0] === null && typeof cardResult[1] === 'number') {
      return cardResult[1];
    }
    return 0;
  }

  private async slidingWindowAdd(
    key:      string,
    ttlSec:   number,
  ): Promise<void> {
    const redis  = getRedis();
    const now    = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    await redis.zadd(key, now, member);
    await redis.expire(key, ttlSec);
  }

  /**
   * Check and record a notification send attempt.
   * Returns FrequencyCapResult with allowed=false if any limit is exceeded.
   *
   * Checks (in order):
   *   1. Global daily limit (12/day)
   *   2. Category daily limit
   *   3. Category hourly limit
   */
  async checkAndRecord(
    userId:    string,
    category:  string,
    channel:   string,
    eventType: string,
  ): Promise<FrequencyCapResult> {
    const catLimits = CATEGORY_LIMITS[category] ?? CATEGORY_LIMITS['TRANSACTIONAL'];
    const now       = Date.now();
    const dayMs     = 86_400_000;
    const hourMs    = 3_600_000;

    // Keys
    const globalDayKey  = `${FREQ_PREFIX}${userId}:global:day`;
    const catDayKey     = `${FREQ_PREFIX}${userId}:${category.toLowerCase()}:day`;
    const catHourKey    = `${FREQ_PREFIX}${userId}:${category.toLowerCase()}:hour`;

    // Count existing usage
    const [globalCount, catDayCount, catHourCount] = await Promise.all([
      this.slidingWindowCount(globalDayKey, dayMs,  90_000),
      this.slidingWindowCount(catDayKey,    dayMs,  90_000),
      this.slidingWindowCount(catHourKey,   hourMs, 7_200),
    ]);

    // 1. Global daily check
    if (globalCount >= GLOBAL_DAILY_LIMIT) {
      logger.warn(
        { userId, category, channel, eventType, globalCount, limit: GLOBAL_DAILY_LIMIT },
        'Frequency cap: global daily limit exceeded',
      );
      return {
        allowed:      false,
        reason:       `Global daily limit of ${GLOBAL_DAILY_LIMIT} notifications exceeded`,
        globalCount,
      };
    }

    // 2. Category daily check
    if (catDayCount >= catLimits.maxPerDay) {
      logger.warn(
        { userId, category, channel, catDayCount, limit: catLimits.maxPerDay },
        'Frequency cap: category daily limit exceeded',
      );
      return {
        allowed:  false,
        reason:   `Category ${category} daily limit of ${catLimits.maxPerDay} exceeded`,
        catCount: catDayCount,
      };
    }

    // 3. Category hourly check
    if (catHourCount >= catLimits.maxPerHour) {
      logger.warn(
        { userId, category, channel, catHourCount, limit: catLimits.maxPerHour },
        'Frequency cap: category hourly limit exceeded',
      );
      return {
        allowed:  false,
        reason:   `Category ${category} hourly limit of ${catLimits.maxPerHour} exceeded`,
        catCount: catHourCount,
      };
    }

    // All checks passed → record the send
    await Promise.all([
      this.slidingWindowAdd(globalDayKey, 90_000),
      this.slidingWindowAdd(catDayKey,    90_000),
      this.slidingWindowAdd(catHourKey,   7_200),
    ]);

    logger.debug(
      { userId, category, channel, globalCount: globalCount + 1 },
      'Frequency cap passed',
    );

    return {
      allowed:      true,
      globalCount:  globalCount + 1,
      catCount:     catDayCount + 1,
    };
  }

  /**
   * Get current usage stats for a user (for dashboards).
   */
  async getUsageStats(userId: string): Promise<Record<string, number>> {
    const dayMs  = 86_400_000;
    const hourMs = 3_600_000;
    const cats   = ['TRANSACTIONAL', 'PROMOTIONAL', 'ALERT', 'REGULATORY'];

    const stats: Record<string, number> = {};
    stats['global_day'] = await this.slidingWindowCount(
      `${FREQ_PREFIX}${userId}:global:day`, dayMs, 90_000,
    );

    for (const cat of cats) {
      const [day, hour] = await Promise.all([
        this.slidingWindowCount(`${FREQ_PREFIX}${userId}:${cat.toLowerCase()}:day`,  dayMs,  90_000),
        this.slidingWindowCount(`${FREQ_PREFIX}${userId}:${cat.toLowerCase()}:hour`, hourMs, 7_200),
      ]);
      stats[`${cat.toLowerCase()}_day`]  = day;
      stats[`${cat.toLowerCase()}_hour`] = hour;
    }

    return stats;
  }
}
