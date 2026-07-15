-- ============================================================
-- Event-Driven Notification Engine — PostgreSQL 15 Schema
-- ============================================================
-- Partitioning Strategy: Monthly RANGE on created_at
-- Indexes: BRIN for time-series, GIN for JSONB
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── ENUM TYPES ────────────────────────────────────────────────

CREATE TYPE notification_channel AS ENUM (
  'SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP'
);

CREATE TYPE notification_status AS ENUM (
  'CREATED', 'ENRICHED', 'ROUTED', 'QUEUED',
  'SENT', 'DELIVERED', 'READ', 'FAILED', 'DEAD_LETTERED'
);

CREATE TYPE notification_category AS ENUM (
  'TRANSACTIONAL', 'PROMOTIONAL', 'ALERT', 'REGULATORY'
);

CREATE TYPE dnd_status AS ENUM (
  'COMPLIANT', 'DND_REGISTERED', 'EXEMPT_TRANSACTIONAL'
);

CREATE TYPE circuit_state AS ENUM (
  'CLOSED', 'OPEN', 'HALF_OPEN'
);

-- ─── USERS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id       VARCHAR(100) UNIQUE NOT NULL,
  full_name         VARCHAR(255) NOT NULL,
  email             VARCHAR(320) NOT NULL,
  phone             VARCHAR(20) NOT NULL,
  timezone          VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  locale            VARCHAR(10) NOT NULL DEFAULT 'en',
  fcm_token         TEXT,
  whatsapp_optin    BOOLEAN NOT NULL DEFAULT FALSE,
  is_dnd_registered BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_external_id ON users(external_id);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);

-- ─── USER PREFERENCES ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_preferences (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel               notification_channel NOT NULL,
  is_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  -- Category-level opt-outs
  transactional_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  promotional_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  alert_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  regulatory_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Quiet hours override per channel
  quiet_hours_override  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Metadata
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, channel)
);

CREATE INDEX idx_user_prefs_user_id ON user_preferences(user_id);

-- ─── NOTIFICATIONS (Partitioned) ──────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id                   UUID NOT NULL DEFAULT uuid_generate_v4(),
  tracking_id          VARCHAR(64) NOT NULL,
  user_id              UUID NOT NULL,
  event_type           VARCHAR(20) NOT NULL,           -- e.g. TXNX-001
  category             notification_category NOT NULL,
  channel              notification_channel NOT NULL,
  status               notification_status NOT NULL DEFAULT 'CREATED',
  priority             SMALLINT NOT NULL DEFAULT 5,     -- 1=critical, 10=lowest
  template_id          VARCHAR(100),
  subject              TEXT,
  body                 TEXT NOT NULL,
  personalisation_data JSONB NOT NULL DEFAULT '{}',
  source_entity_id     VARCHAR(255),                   -- txn_id, order_id, etc.
  idempotency_key      VARCHAR(128) UNIQUE,
  provider_message_id  VARCHAR(255),
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  read_at              TIMESTAMPTZ,
  retry_count          SMALLINT NOT NULL DEFAULT 0,
  max_retries          SMALLINT NOT NULL DEFAULT 3,
  error_message        TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions for 2025-2026
CREATE TABLE notifications_2025_01 PARTITION OF notifications
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE notifications_2025_02 PARTITION OF notifications
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE notifications_2025_03 PARTITION OF notifications
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE notifications_2025_04 PARTITION OF notifications
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE notifications_2025_05 PARTITION OF notifications
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE notifications_2025_06 PARTITION OF notifications
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE notifications_2025_07 PARTITION OF notifications
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE notifications_2025_08 PARTITION OF notifications
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE notifications_2025_09 PARTITION OF notifications
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE notifications_2025_10 PARTITION OF notifications
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE notifications_2025_11 PARTITION OF notifications
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE notifications_2025_12 PARTITION OF notifications
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE notifications_2026_01 PARTITION OF notifications
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE notifications_2026_02 PARTITION OF notifications
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE notifications_2026_03 PARTITION OF notifications
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE notifications_2026_04 PARTITION OF notifications
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE notifications_2026_05 PARTITION OF notifications
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE notifications_2026_06 PARTITION OF notifications
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE notifications_2026_07 PARTITION OF notifications
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE notifications_2026_08 PARTITION OF notifications
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE notifications_2026_09 PARTITION OF notifications
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE notifications_2026_10 PARTITION OF notifications
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE notifications_2026_11 PARTITION OF notifications
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE notifications_2026_12 PARTITION OF notifications
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- BRIN index for efficient time-series range scans
CREATE INDEX idx_notifications_created_brin
  ON notifications USING BRIN (created_at) WITH (pages_per_range = 128);

-- GIN index for JSONB personalisation_data queries
CREATE INDEX idx_notifications_personalisation_gin
  ON notifications USING GIN (personalisation_data);

-- GIN index for metadata JSONB
CREATE INDEX idx_notifications_metadata_gin
  ON notifications USING GIN (metadata);

-- B-Tree indexes for common filter patterns
CREATE INDEX idx_notifications_user_id    ON notifications(user_id);
CREATE INDEX idx_notifications_status     ON notifications(status);
CREATE INDEX idx_notifications_event_type ON notifications(event_type);
CREATE INDEX idx_notifications_tracking   ON notifications(tracking_id);
CREATE INDEX idx_notifications_channel    ON notifications(channel);

-- ─── NOTIFICATION STATE LOG ───────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_state_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id  UUID NOT NULL,
  from_status      notification_status,
  to_status        notification_status NOT NULL,
  actor            VARCHAR(100) NOT NULL DEFAULT 'system',
  reason           TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_log_notification_id ON notification_state_log(notification_id);
CREATE INDEX idx_state_log_created_brin
  ON notification_state_log USING BRIN (created_at);

-- ─── DEAD LETTER QUEUE ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id  UUID,
  tracking_id      VARCHAR(64),
  event_type       VARCHAR(20),
  channel          notification_channel,
  original_payload JSONB NOT NULL,
  error_message    TEXT,
  error_stack      TEXT,
  retry_count      SMALLINT NOT NULL DEFAULT 0,
  kafka_topic      VARCHAR(255),
  kafka_partition  INTEGER,
  kafka_offset     BIGINT,
  resolved         BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at      TIMESTAMPTZ,
  resolved_by      VARCHAR(100),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dlq_notification_id ON dead_letter_queue(notification_id);
CREATE INDEX idx_dlq_resolved        ON dead_letter_queue(resolved);
CREATE INDEX idx_dlq_created_brin
  ON dead_letter_queue USING BRIN (created_at);

-- ─── SEED DATA: Demo users ─────────────────────────────────────

INSERT INTO users (external_id, full_name, email, phone, timezone, locale) VALUES
  ('USR001', 'Arjun Sharma',    'arjun.sharma@example.com',    '+919876543210', 'Asia/Kolkata',  'hi'),
  ('USR002', 'Priya Nair',      'priya.nair@example.com',      '+918765432109', 'Asia/Kolkata',  'en'),
  ('USR003', 'Ravi Krishnan',   'ravi.krishnan@example.com',   '+917654321098', 'Asia/Kolkata',  'ta'),
  ('USR004', 'Sneha Patel',     'sneha.patel@example.com',     '+916543210987', 'Asia/Kolkata',  'mr'),
  ('USR005', 'Deepak Reddy',    'deepak.reddy@example.com',    '+915432109876', 'Asia/Kolkata',  'te')
ON CONFLICT (external_id) DO NOTHING;

-- Seed preferences for each user × channel
INSERT INTO user_preferences (user_id, channel, is_enabled, transactional_enabled, promotional_enabled)
SELECT id, unnest(ARRAY['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP']::notification_channel[]),
       TRUE, TRUE, FALSE
FROM users
ON CONFLICT (user_id, channel) DO NOTHING;
