import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { publishToKafka } from '../config/kafka-rabbitmq';
import { NotificationRequestSchema } from '../templates/template.renderer';
import { DndScrubber } from '../core/dnd-scrubber';
import { FrequencyCapService } from '../core/frequency-cap';
import { IdempotencyService } from '../core/idempotency';
import { NotificationStateMachine } from '../core/state-machine';
import { logger } from '../server';
import {
  notificationsReceivedTotal,
  notificationsFailedTotal,
} from './metrics.routes';

export const apiRouter = Router();

const freqCap     = new FrequencyCapService();
const idempotency = new IdempotencyService();

// ─── Helper: Zod validation middleware ───────────────────────

function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error:   'Validation failed',
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ─── POST /api/notify ─────────────────────────────────────────
// Main ingestion endpoint — validates, guards, and publishes to Kafka

apiRouter.post(
  '/notify',
  validateBody(NotificationRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    const payload = req.body as z.infer<typeof NotificationRequestSchema>;
    const trackingId = payload.trackingId ?? uuidv4();

    notificationsReceivedTotal.inc({ event_type: payload.eventType });

    // 1. Idempotency check
    const isNew = await idempotency.checkAndSet(
      payload.eventType,
      payload.sourceEntityId,
      trackingId,
      new Date(payload.timestamp).getTime(),
    );
    if (!isNew) {
      res.status(202).json({
        message:    'Duplicate event detected — skipped',
        trackingId,
      });
      return;
    }

    // 2. Fetch user record
    const userResult = await query(
      'SELECT id, full_name, email, phone, timezone, locale, is_dnd_registered FROM users WHERE external_id = $1',
      [payload.userId],
    );
    if (userResult.rowCount === 0) {
      notificationsFailedTotal.inc({ event_type: payload.eventType, reason: 'user_not_found' });
      res.status(404).json({ error: `User ${payload.userId} not found` });
      return;
    }
    const user = userResult.rows[0];

    // 3. Frequency cap
    const category = DndScrubber.resolveCategory(payload.eventType);
    const freqResult = await freqCap.checkAndRecord(
      user.id,
      category,
      payload.channels[0] ?? 'SMS',
      payload.eventType,
    );
    if (!freqResult.allowed) {
      notificationsFailedTotal.inc({ event_type: payload.eventType, reason: 'freq_cap' });
      res.status(429).json({
        error:  'Frequency cap exceeded',
        reason: freqResult.reason,
      });
      return;
    }

    // 4. DND + Quiet Hours check
    const dndResult = DndScrubber.check({
      userId:          user.id,
      phone:           user.phone,
      eventType:       payload.eventType,
      category,
      channel:         payload.channels[0] ?? 'SMS',
      userTimezone:    user.timezone,
      isDndRegistered: user.is_dnd_registered,
    });
    if (!dndResult.allowed) {
      notificationsFailedTotal.inc({ event_type: payload.eventType, reason: 'dnd_blocked' });
      res.status(202).json({
        message:    'Notification suppressed by DND/Quiet Hours policy',
        reason:     dndResult.reason,
        trackingId,
      });
      return;
    }

    // 5. Publish to appropriate Kafka topic
    const isCritical = payload.priority <= 2;
    const kafkaTopic = isCritical
      ? (process.env['KAFKA_TOPIC_CRITICAL'] ?? 'fin-events-critical')
      : (process.env['KAFKA_TOPIC_STANDARD'] ?? 'fin-events-standard');

    await publishToKafka(kafkaTopic, {
      trackingId,
      eventType:      payload.eventType,
      userId:         user.id,
      sourceEntityId: payload.sourceEntityId,
      payload:        payload.personalisation,
      priority:       payload.priority,
      timestamp:      payload.timestamp,
      locale:         payload.locale ?? user.locale,
      channels:       payload.channels,
    });

    logger.info(
      { trackingId, eventType: payload.eventType, userId: user.id, kafkaTopic },
      'Event published to Kafka',
    );

    res.status(202).json({
      message:    'Notification event accepted',
      trackingId,
      topic:      kafkaTopic,
    });
  },
);

// ─── GET /api/notifications ───────────────────────────────────

apiRouter.get('/notifications', async (req: Request, res: Response): Promise<void> => {
  const limit  = Math.min(parseInt(String(req.query['limit']  ?? '50'),  10), 200);
  const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'),   10), 0);
  const status = req.query['status'] as string | undefined;
  const userId = req.query['userId'] as string | undefined;

  let sql = `
    SELECT n.id, n.tracking_id, n.user_id, n.event_type, n.category, n.channel,
           n.status, n.priority, n.subject, n.body, n.source_entity_id,
           n.sent_at, n.delivered_at, n.read_at, n.retry_count, n.error_message,
           n.created_at, n.updated_at,
           u.external_id as user_external_id, u.full_name as user_name
    FROM   notifications n
    JOIN   users u ON u.id = n.user_id
    WHERE  n.created_at >= NOW() - INTERVAL '7 days'
  `;
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    sql += ` AND n.status = $${params.length}`;
  }
  if (userId) {
    params.push(userId);
    sql += ` AND u.external_id = $${params.length}`;
  }

  params.push(limit, offset);
  sql += ` ORDER BY n.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const result = await query(sql, params);

  res.json({
    total: result.rowCount,
    limit,
    offset,
    data:  result.rows,
  });
});

// ─── GET /api/notifications/:id ───────────────────────────────

apiRouter.get('/notifications/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const notifResult = await query(
    `SELECT n.*, u.external_id as user_external_id, u.full_name as user_name
     FROM   notifications n
     JOIN   users u ON u.id = n.user_id
     WHERE  n.id = $1`,
    [id],
  );

  if (notifResult.rowCount === 0) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  const stateLog = await query(
    'SELECT * FROM notification_state_log WHERE notification_id = $1 ORDER BY created_at ASC',
    [id],
  );

  res.json({
    notification: notifResult.rows[0],
    stateHistory: stateLog.rows,
  });
});

// ─── GET /api/users/:id/preferences ──────────────────────────

apiRouter.get('/users/:id/preferences', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const userResult = await query(
    'SELECT id, external_id, full_name, email, phone, timezone, locale, is_dnd_registered FROM users WHERE external_id = $1',
    [id],
  );
  if (userResult.rowCount === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const user = userResult.rows[0];

  const prefs = await query(
    `SELECT channel, is_enabled, transactional_enabled, promotional_enabled,
            alert_enabled, regulatory_enabled, quiet_hours_override, updated_at
     FROM   user_preferences
     WHERE  user_id = $1
     ORDER  BY channel`,
    [user.id],
  );

  res.json({
    user,
    preferences: prefs.rows,
  });
});

// ─── PUT /api/users/:id/preferences ──────────────────────────

const PreferencesUpdateSchema = z.object({
  channel:               z.enum(['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP']),
  is_enabled:            z.boolean().optional(),
  transactional_enabled: z.boolean().optional(),
  promotional_enabled:   z.boolean().optional(),
  alert_enabled:         z.boolean().optional(),
  regulatory_enabled:    z.boolean().optional(),
  quiet_hours_override:  z.boolean().optional(),
});

apiRouter.put(
  '/users/:id/preferences',
  validateBody(PreferencesUpdateSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const update = req.body as z.infer<typeof PreferencesUpdateSchema>;

    const userResult = await query(
      'SELECT id FROM users WHERE external_id = $1',
      [id],
    );
    if (userResult.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const userId = userResult.rows[0].id;

    await query(
      `INSERT INTO user_preferences
         (user_id, channel, is_enabled, transactional_enabled, promotional_enabled,
          alert_enabled, regulatory_enabled, quiet_hours_override)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, channel) DO UPDATE SET
         is_enabled            = COALESCE($3, user_preferences.is_enabled),
         transactional_enabled = COALESCE($4, user_preferences.transactional_enabled),
         promotional_enabled   = COALESCE($5, user_preferences.promotional_enabled),
         alert_enabled         = COALESCE($6, user_preferences.alert_enabled),
         regulatory_enabled    = COALESCE($7, user_preferences.regulatory_enabled),
         quiet_hours_override  = COALESCE($8, user_preferences.quiet_hours_override),
         updated_at            = NOW()`,
      [
        userId,
        update.channel,
        update.is_enabled ?? null,
        update.transactional_enabled ?? null,
        update.promotional_enabled   ?? null,
        update.alert_enabled         ?? null,
        update.regulatory_enabled    ?? null,
        update.quiet_hours_override  ?? null,
      ],
    );

    res.json({ message: 'Preferences updated', userId: id, channel: update.channel });
  },
);

// ─── POST /api/simulate-event ─────────────────────────────────
// Convenience endpoint for testing the full pipeline

const SAMPLE_EVENTS = [
  { eventType: 'TXNX-001', userId: 'USR001', sourceEntityId: 'TXN12345', priority: 5, personalisation: { amount: 15000, userName: 'Arjun Sharma', accountMasked: 'XXXX4567', date: new Date().toLocaleDateString('en-IN'), txnId: 'TXN12345' } },
  { eventType: 'TXNX-002', userId: 'USR002', sourceEntityId: 'TXN67890', priority: 5, personalisation: { amount: 50000, userName: 'Priya Nair', accountMasked: 'XXXX7890', date: new Date().toLocaleDateString('en-IN'), txnId: 'TXN67890' } },
  { eventType: 'RISK-002', userId: 'USR001', sourceEntityId: 'MARGIN001', priority: 1, personalisation: { shortfallAmount: 75000, userName: 'Arjun Sharma', deadline: '4:00 PM today' } },
  { eventType: 'SIPX-001', userId: 'USR003', sourceEntityId: 'SIP98765', priority: 5, personalisation: { amount: 5000, userName: 'Ravi Krishnan', sipName: 'HDFC Mid-Cap', folioNumber: 'FOL12345', nav: '45.67', units: '109.5' } },
  { eventType: 'MKTX-001', userId: 'USR004', sourceEntityId: 'ALERT001', priority: 3, personalisation: { symbol: 'RELIANCE', direction: 'crossed', price: 2850.50, currentPrice: 2855.20, userName: 'Sneha Patel', alertTime: '14:30' } },
  { eventType: 'REGX-001', userId: 'USR005', sourceEntityId: 'KYC001',   priority: 7, personalisation: { userName: 'Deepak Reddy', expiryDate: '31 Aug 2026' } },
];

apiRouter.post('/simulate-event', async (req: Request, res: Response): Promise<void> => {
  const sample = SAMPLE_EVENTS[Math.floor(Math.random() * SAMPLE_EVENTS.length)]!;

  const eventPayload = {
    trackingId:      uuidv4(),
    userId:          req.body?.userId ?? sample.userId,
    eventType:       req.body?.eventType ?? sample.eventType,
    sourceEntityId:  req.body?.sourceEntityId ?? `${sample.sourceEntityId}_${Date.now()}`,
    channels:        req.body?.channels ?? ['SMS', 'EMAIL', 'PUSH', 'INAPP'],
    priority:        req.body?.priority ?? sample.priority,
    locale:          req.body?.locale ?? 'en',
    personalisation: req.body?.personalisation ?? sample.personalisation,
    timestamp:       new Date().toISOString(),
  };

  const parsed = NotificationRequestSchema.parse(eventPayload);
  const isCritical = parsed.priority <= 2;

  await publishToKafka(
    isCritical
      ? (process.env['KAFKA_TOPIC_CRITICAL'] ?? 'fin-events-critical')
      : (process.env['KAFKA_TOPIC_STANDARD'] ?? 'fin-events-standard'),
    {
      trackingId:     parsed.trackingId,
      eventType:      parsed.eventType,
      userId:         parsed.userId,
      sourceEntityId: parsed.sourceEntityId,
      payload:        parsed.personalisation,
      priority:       parsed.priority,
      timestamp:      parsed.timestamp,
      locale:         parsed.locale,
      channels:       parsed.channels,
    },
  );

  notificationsReceivedTotal.inc({ event_type: parsed.eventType });

  logger.info({ trackingId: parsed.trackingId, eventType: parsed.eventType }, 'Simulated event published');

  res.status(202).json({
    message:    'Simulated event published',
    trackingId: parsed.trackingId,
    eventType:  parsed.eventType,
    userId:     parsed.userId,
  });
});

// ─── GET /api/analytics/summary ──────────────────────────────

apiRouter.get('/analytics/summary', async (_req: Request, res: Response): Promise<void> => {
  const [totalResult, channelResult, statusResult, recentResult] = await Promise.all([
    query(`
      SELECT COUNT(*)::int as total,
             COUNT(*) FILTER (WHERE status = 'DELIVERED')::int as delivered,
             COUNT(*) FILTER (WHERE status = 'FAILED')::int as failed,
             COUNT(*) FILTER (WHERE status = 'DEAD_LETTERED')::int as dead_lettered
      FROM notifications WHERE created_at >= NOW() - INTERVAL '24 hours'
    `),
    query(`
      SELECT channel, COUNT(*)::int as count,
             COUNT(*) FILTER (WHERE status = 'DELIVERED')::int as delivered
      FROM notifications
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY channel ORDER BY count DESC
    `),
    query(`
      SELECT status, COUNT(*)::int as count
      FROM notifications
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY status
    `),
    query(`
      SELECT n.id, n.tracking_id, n.event_type, n.channel, n.status,
             n.priority, n.created_at, u.full_name as user_name
      FROM notifications n
      JOIN users u ON u.id = n.user_id
      WHERE n.created_at >= NOW() - INTERVAL '1 hour'
      ORDER BY n.created_at DESC LIMIT 20
    `),
  ]);

  const summary = totalResult.rows[0] ?? { total: 0, delivered: 0, failed: 0, dead_lettered: 0 };
  const total   = summary.total ?? 0;

  res.json({
    summary: {
      ...summary,
      successRate: total > 0 ? Math.round((summary.delivered / total) * 100) : 0,
    },
    byChannel: channelResult.rows,
    byStatus:  statusResult.rows,
    recent:    recentResult.rows,
  });
});

// ─── GET /api/analytics/throughput ───────────────────────────

apiRouter.get('/analytics/throughput', async (_req: Request, res: Response): Promise<void> => {
  const result = await query(`
    SELECT
      date_trunc('hour', created_at) AS hour,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      channel
    FROM notifications
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY hour, channel
    ORDER BY hour ASC
  `);
  res.json({ data: result.rows });
});

// ─── GET /api/dead-letter ─────────────────────────────────────

apiRouter.get('/dead-letter', async (req: Request, res: Response): Promise<void> => {
  const limit  = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10), 200);
  const result = await query(
    'SELECT * FROM dead_letter_queue WHERE resolved = FALSE ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  res.json({ total: result.rowCount, data: result.rows });
});

// ─── GET /api/health ──────────────────────────────────────────

apiRouter.get('/health', async (_req: Request, res: Response): Promise<void> => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
