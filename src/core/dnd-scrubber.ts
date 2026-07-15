import { DateTime } from 'luxon';
import { logger } from '../server';

// ─── Event Types and Categories ───────────────────────────────

/**
 * TRAI Classification:
 * - TRANSACTIONAL: Exempt from DND. Can be sent anytime.
 * - PROMOTIONAL:   Subject to DND registry. Blocked for registered users.
 * - ALERT:         Treated as Transactional.
 * - REGULATORY:    Always sent (compliance mandate). Overrides DND and quiet hours.
 */
export type TraiCategory = 'TRANSACTIONAL' | 'PROMOTIONAL' | 'ALERT' | 'REGULATORY';

// Critical event types that bypass quiet hours
const QUIET_HOURS_BYPASS_EVENTS = new Set([
  'RISK-002',   // Margin shortfall — critical
  'RISK-003',   // Forced liquidation alert
  'REGX-001',   // Regulatory mandate
  'REGX-002',   // Tax filing deadline
]);

// Quiet hours: 21:00 – 08:00 user local time
const QUIET_START_HOUR = parseInt(process.env['QUIET_HOURS_START'] ?? '21', 10);
const QUIET_END_HOUR   = parseInt(process.env['QUIET_HOURS_END']   ?? '8',  10);

// ─── Types ────────────────────────────────────────────────────

export interface DndCheckInput {
  userId:      string;
  phone:       string;
  eventType:   string;
  category:    TraiCategory;
  channel:     string;
  userTimezone: string;
  isDndRegistered: boolean;
}

export interface DndCheckResult {
  allowed:      boolean;
  reason?:      string;
  isQuietHours?: boolean;
  isDndBlocked?: boolean;
}

// ─── DND Scrubber ─────────────────────────────────────────────

export class DndScrubber {
  /**
   * Run full DND + Quiet Hours compliance checks.
   *
   * Rules (in priority order):
   *  1. REGULATORY events always pass (legal mandate).
   *  2. RISK-002/003 bypass quiet hours but still respect DND.
   *  3. PROMOTIONAL → blocked if user is DND-registered.
   *  4. Quiet hours blocked for non-critical, non-regulatory.
   *  5. All other TRANSACTIONAL/ALERT pass.
   */
  static check(input: DndCheckInput): DndCheckResult {
    const {
      eventType,
      category,
      channel,
      userTimezone,
      isDndRegistered,
    } = input;

    // ── Rule 1: Regulatory always passes ──────────────────────
    if (category === 'REGULATORY') {
      return { allowed: true };
    }

    // ── Rule 2: SMS DND check ─────────────────────────────────
    if (channel === 'SMS' && isDndRegistered) {
      if (category === 'PROMOTIONAL') {
        logger.info(
          { userId: input.userId, eventType, channel },
          'DND: user is DND-registered and category is PROMOTIONAL — blocked',
        );
        return {
          allowed:      false,
          isDndBlocked: true,
          reason:       'User is TRAI DND-registered; PROMOTIONAL SMS blocked',
        };
      }
      // TRANSACTIONAL/ALERT are exempt from DND
    }

    // ── Rule 3: Quiet hours check ─────────────────────────────
    const isCriticalBypass = QUIET_HOURS_BYPASS_EVENTS.has(eventType);

    if (!isCriticalBypass) {
      const isQuiet = DndScrubber.isInQuietHours(userTimezone);
      if (isQuiet) {
        logger.info(
          { userId: input.userId, eventType, channel, userTimezone },
          'DND: quiet hours active — notification deferred',
        );
        return {
          allowed:       false,
          isQuietHours:  true,
          reason:        `Quiet hours (${QUIET_START_HOUR}:00–${QUIET_END_HOUR}:00 in ${userTimezone})`,
        };
      }
    } else {
      logger.debug(
        { eventType },
        'DND: quiet hours bypass active for critical event',
      );
    }

    return { allowed: true };
  }

  /**
   * Determine if the current moment is within quiet hours for the
   * given IANA timezone string.
   *
   * Quiet window wraps midnight: 21:00 → next day 08:00.
   */
  static isInQuietHours(timezone: string): boolean {
    let userNow: DateTime;
    try {
      userNow = DateTime.now().setZone(timezone);
    } catch {
      // Fallback to IST if unknown timezone
      userNow = DateTime.now().setZone('Asia/Kolkata');
    }

    const hour = userNow.hour;

    // Window spans midnight: [21, 0, 1, ..., 7] are quiet
    if (QUIET_START_HOUR > QUIET_END_HOUR) {
      return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
    }
    // Normal window (doesn't cross midnight)
    return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
  }

  /**
   * Map event_type prefix to TRAI category.
   */
  static resolveCategory(eventType: string): TraiCategory {
    const prefix = eventType.split('-')[0] ?? '';
    const mapping: Record<string, TraiCategory> = {
      TXNX: 'TRANSACTIONAL',
      SIPX: 'TRANSACTIONAL',
      MKTX: 'PROMOTIONAL',
      RISK: 'ALERT',
      REGX: 'REGULATORY',
    };
    return mapping[prefix] ?? 'TRANSACTIONAL';
  }
}
