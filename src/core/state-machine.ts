import { query, withTransaction } from '../config/database';
import { logger } from '../server';

// ─── State Definitions ────────────────────────────────────────

export const NotificationStatus = {
  CREATED:       'CREATED',
  ENRICHED:      'ENRICHED',
  ROUTED:        'ROUTED',
  QUEUED:        'QUEUED',
  SENT:          'SENT',
  DELIVERED:     'DELIVERED',
  READ:          'READ',
  FAILED:        'FAILED',
  DEAD_LETTERED: 'DEAD_LETTERED',
} as const;

export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

// ─── Valid Transitions Map ─────────────────────────────────────

const VALID_TRANSITIONS: Readonly<Record<NotificationStatus, readonly NotificationStatus[]>> = {
  CREATED:       ['ENRICHED', 'FAILED'],
  ENRICHED:      ['ROUTED', 'FAILED'],
  ROUTED:        ['QUEUED', 'FAILED'],
  QUEUED:        ['SENT', 'FAILED'],
  SENT:          ['DELIVERED', 'FAILED'],
  DELIVERED:     ['READ'],
  READ:          [],
  FAILED:        ['QUEUED', 'DEAD_LETTERED'],  // allow retry re-queue
  DEAD_LETTERED: [],
};

// ─── Transition Event ─────────────────────────────────────────

export interface TransitionOptions {
  notificationId: string;
  fromStatus:     NotificationStatus;
  toStatus:       NotificationStatus;
  actor?:         string;
  reason?:        string;
  metadata?:      Record<string, unknown>;
}

// ─── State Machine ────────────────────────────────────────────

export class NotificationStateMachine {
  /**
   * Validates the requested transition. Throws if the transition is illegal.
   */
  static validateTransition(from: NotificationStatus, to: NotificationStatus): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid state transition: ${from} → ${to}. ` +
        `Allowed: [${allowed.join(', ')}]`,
      );
    }
  }

  /**
   * Atomically transition a notification's status in PostgreSQL and
   * write the corresponding log entry. Uses an optimistic-lock pattern
   * (WHERE status = fromStatus) to prevent concurrent transition races.
   */
  static async transition(opts: TransitionOptions): Promise<boolean> {
    const {
      notificationId,
      fromStatus,
      toStatus,
      actor    = 'system',
      reason,
      metadata = {},
    } = opts;

    NotificationStateMachine.validateTransition(fromStatus, toStatus);

    return withTransaction(async (client) => {
      // Optimistic lock: only update if current status matches expected
      const updateResult = await client.query<{ id: string }>(
        `UPDATE notifications
         SET    status     = $1,
                updated_at = NOW(),
                sent_at      = CASE WHEN $1 = 'SENT'      THEN NOW() ELSE sent_at      END,
                delivered_at = CASE WHEN $1 = 'DELIVERED' THEN NOW() ELSE delivered_at END,
                read_at      = CASE WHEN $1 = 'READ'      THEN NOW() ELSE read_at      END
         WHERE  id = $2
         AND    status = $3
         RETURNING id`,
        [toStatus, notificationId, fromStatus],
      );

      if (updateResult.rowCount === 0) {
        logger.warn(
          { notificationId, fromStatus, toStatus },
          'State transition skipped — concurrent update or unexpected state',
        );
        return false;
      }

      // Log the transition
      await client.query(
        `INSERT INTO notification_state_log
           (notification_id, from_status, to_status, actor, reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [notificationId, fromStatus, toStatus, actor, reason ?? null, JSON.stringify(metadata)],
      );

      logger.info(
        { notificationId, fromStatus, toStatus, actor },
        'Notification state transitioned',
      );
      return true;
    });
  }

  /**
   * Fetch the current status of a notification.
   */
  static async getCurrentStatus(notificationId: string): Promise<NotificationStatus | null> {
    const result = await query<{ status: NotificationStatus }>(
      'SELECT status FROM notifications WHERE id = $1',
      [notificationId],
    );
    return result.rows[0]?.status ?? null;
  }

  /**
   * Mark a notification as DEAD_LETTERED with error context.
   */
  static async deadLetter(
    notificationId: string,
    currentStatus: NotificationStatus,
    errorMessage: string,
  ): Promise<void> {
    try {
      await NotificationStateMachine.transition({
        notificationId,
        fromStatus: currentStatus,
        toStatus:   'DEAD_LETTERED',
        actor:      'dlq-handler',
        reason:     errorMessage,
      });
    } catch (err) {
      logger.error({ err, notificationId }, 'Failed to dead-letter notification');
    }
  }
}
