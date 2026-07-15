# Event-Driven Notification Engine 🚀

> Enterprise-scale, fault-tolerant financial notification platform processing **25+ event types** across **5 delivery channels** with a real-time React admin dashboard.

---

## Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │         Kafka Ingestion Layer           │
                    │  fin-events-critical  fin-events-standard│
                    │  (Priority 1–2)       (Priority 3–10)   │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │      Event Processing Pipeline          │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
                    │  │Idempotency│ │ Freq Cap │ │   DND   │ │
                    │  │  (Redis) │ │ (Sliding │ │Scrubber │ │
                    │  │  SHA-256 │ │ Window)  │ │  TRAI   │ │
                    │  └──────────┘ └──────────┘ └─────────┘ │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │       State Machine FSM                 │
                    │  CREATED→ENRICHED→ROUTED→QUEUED→        │
                    │  SENT→DELIVERED→READ | FAILED→DLQ       │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │       RabbitMQ Delivery Queues          │
                    │  notif.sms  notif.email  notif.push     │
                    │  notif.whatsapp  notif.inapp  notif.dlq │
                    └────┬──────┬──────┬─────┬───────────────┘
                         │      │      │     │
                    ┌────▼─┐ ┌──▼─┐ ┌─▼──┐ ┌▼──────┐
                    │ SMS  │ │Email│ │Push│ │WA/App │
                    │Prov. │ │Prov.│ │FCM │ │Prov.  │
                    └──────┘ └────┘ └────┘ └───────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │         React Dashboard (UI)            │
                    │  DashboardStats  LiveQueue  UserPrefs   │
                    └─────────────────────────────────────────┘
```

---

## Tech Stack

| Layer              | Technology                        |
|--------------------|-----------------------------------|
| **Backend**        | Node.js 20, TypeScript (strict)   |
| **Web Framework**  | Express.js 4                      |
| **Event Streaming**| Apache Kafka (KafkaJS 2)          |
| **Message Queues** | RabbitMQ 3.13 (amqplib)           |
| **Primary DB**     | PostgreSQL 15 (range partitioned) |
| **Cache / KV**     | Redis 7 (ioredis)                 |
| **Frontend**       | React 18, TypeScript, Vite        |
| **Styling**        | Tailwind CSS 3                    |
| **Charts**         | Recharts                          |
| **Icons**          | Lucide React                      |
| **Logging**        | Pino (structured JSON)            |
| **Templates**      | Handlebars                        |
| **Validation**     | Zod                               |

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)

### Option 1 — Full Docker Stack

```bash
# Clone and start all services
cd notification-engine
cp .env.example .env
docker-compose up -d

# Watch logs
docker-compose logs -f backend
```

Services will be available at:
| Service       | URL                          |
|---------------|------------------------------|
| Backend API   | http://localhost:3000/api    |
| Metrics       | http://localhost:3000/metrics|
| Admin UI      | http://localhost:3001        |
| Kafka UI*     | (use kafka-ui image optionally) |
| RabbitMQ Mgmt | http://localhost:15672       |

### Option 2 — Local Development

```bash
# Terminal 1: Start infrastructure
docker-compose up -d zookeeper kafka rabbitmq postgres redis

# Terminal 2: Start backend
cd notification-engine
npm install
npm run dev

# Terminal 3: Start frontend
cd ui
npm install
npm run dev
# → http://localhost:3001
```

---

## Event Taxonomy (25 types)

| Category       | Code     | Description                     |
|----------------|----------|---------------------------------|
| **TXNX**       | TXNX-001 | Debit alert                     |
|                | TXNX-002 | Credit alert                    |
|                | TXNX-003 | Fund transfer initiated         |
|                | TXNX-004 | Fund transfer success           |
|                | TXNX-005 | Fund transfer failed            |
|                | TXNX-006 | Cheque bounce                   |
|                | TXNX-007 | Auto-debit scheduled            |
|                | TXNX-008 | Auto-debit executed             |
| **SIPX**       | SIPX-001 | SIP instalment processed        |
|                | SIPX-002 | SIP instalment failed           |
|                | SIPX-003 | SIP created                     |
|                | SIPX-004 | SIP cancelled                   |
|                | SIPX-005 | SIP amount changed              |
| **MKTX**       | MKTX-001 | Price alert triggered           |
|                | MKTX-002 | Portfolio daily summary         |
|                | MKTX-003 | Market open/close               |
|                | MKTX-004 | IPO allotment                   |
|                | MKTX-005 | Dividend credited               |
| **RISK** 🚨    | RISK-001 | Portfolio value drop            |
|                | RISK-002 | Margin shortfall (CRITICAL*)    |
|                | RISK-003 | Forced liquidation (CRITICAL*)  |
|                | RISK-004 | Stop-loss triggered             |
| **REGX**       | REGX-001 | KYC expiry reminder             |
|                | REGX-002 | Tax filing deadline             |
|                | REGX-003 | ITR filing notice               |
|                | REGX-004 | Account statement ready         |

> *CRITICAL events bypass quiet hours and DND restrictions

---

## API Reference

### Notify
```http
POST /api/notify
Content-Type: application/json

{
  "trackingId": "uuid-v4",
  "userId": "USR001",
  "eventType": "TXNX-001",
  "sourceEntityId": "TXN12345",
  "channels": ["SMS", "EMAIL", "PUSH"],
  "priority": 5,
  "locale": "en",
  "personalisation": {
    "amount": 15000,
    "userName": "Arjun Sharma",
    "accountMasked": "XXXX4567"
  },
  "timestamp": "2026-07-14T10:00:00.000Z"
}
```

### Simulate Event (Quick Test)
```http
POST /api/simulate-event
# Returns random sample event through the full pipeline
```

### User Preferences
```http
GET  /api/users/{externalId}/preferences
PUT  /api/users/{externalId}/preferences
```

### Analytics
```http
GET /api/analytics/summary
GET /api/analytics/throughput
GET /api/notifications?status=DELIVERED&limit=50
GET /api/dead-letter
```

### Prometheus Metrics
```http
GET /metrics
# notif_engine_notifications_received_total{event_type="TXNX-001"}
# notif_engine_notifications_failed_total{event_type,reason}
# notif_engine_delivery_latency_ms_bucket{channel,le}
# notif_engine_kafka_consumer_lag
```

---

## Core Guardrails

### Idempotency
- SHA-256 fingerprint: `eventType + sourceEntityId + 5-min timestamp window`
- Redis `SET NX EX 3600` — atomic, 1-hour dedup window

### Frequency Cap (Sliding Window)
| Scope            | Limit       |
|------------------|-------------|
| Global (per user)| 12 / day    |
| TRANSACTIONAL    | 50/day, 20/hr|
| PROMOTIONAL      | 3/day, 2/hr |
| ALERT            | 20/day, 10/hr|
| REGULATORY       | 10/day, 5/hr |

### DND & Quiet Hours
- **Quiet Hours:** 21:00–08:00 (user's IANA timezone)
- **TRAI DND:** Blocks PROMOTIONAL SMS/WhatsApp for registered users
- **CRITICAL Bypass:** RISK-002, RISK-003, REGX-001 bypass quiet hours

### Circuit Breaker
```
CLOSED ──(5 failures)──▶ OPEN ──(30s)──▶ HALF_OPEN
  ▲                                           │
  └───────────────(success)───────────────────┘
```
Jittered exponential backoff: base 1s × 2^n + random jitter (max 30s)

### State Machine
```
CREATED → ENRICHED → ROUTED → QUEUED → SENT → DELIVERED → READ
                                                  │
                                              FAILED → (retry) → DEAD_LETTERED
```
Every transition logged to `notification_state_log` with actor + metadata.

---

## Database Schema

- **`notifications`** — Monthly range-partitioned (2025-01 through 2026-12)
  - BRIN index on `created_at` for time-series scans
  - GIN index on `personalisation_data` JSONB
- **`notification_state_log`** — Full audit trail of state transitions
- **`user_preferences`** — Per-user, per-channel delivery preferences
- **`dead_letter_queue`** — Failed notifications with error context
- **`users`** — User registry with timezone/locale/DND status

---

## Project Structure

```
notification-engine/
├── .env.example              # Environment template
├── docker-compose.yml        # Full stack orchestration
├── Dockerfile                # Multi-stage backend build
├── package.json
├── tsconfig.json             # strict: true, noImplicitAny: true
├── src/
│   ├── server.ts             # Bootstrap, Kafka consumers, WS server
│   ├── config/
│   │   ├── database.ts       # pg Pool + helpers
│   │   └── kafka-rabbitmq.ts # KafkaJS + amqplib clients
│   ├── core/
│   │   ├── state-machine.ts  # FSM with optimistic locking
│   │   ├── idempotency.ts    # Redis SHA-256 fingerprint
│   │   ├── frequency-cap.ts  # Sliding window rate limiter
│   │   └── dnd-scrubber.ts   # TRAI DND + quiet hours
│   ├── database/
│   │   └── schema.sql        # Partitioned tables + indexes
│   ├── interfaces/
│   │   └── provider.interface.ts  # DeliveryProvider + CircuitBreaker
│   ├── providers/
│   │   ├── sms.provider.ts
│   │   ├── email.provider.ts
│   │   ├── push.provider.ts
│   │   ├── whatsapp.provider.ts
│   │   └── inapp.provider.ts
│   ├── routes/
│   │   ├── api.routes.ts     # REST endpoints
│   │   └── metrics.routes.ts # Prometheus /metrics
│   └── templates/
│       └── template.renderer.ts  # Handlebars + 26 templates
└── ui/
    ├── src/
    │   ├── App.tsx            # SPA layout + sidebar
    │   ├── components/
    │   │   ├── DashboardStats.tsx      # Metric cards + Recharts
    │   │   ├── LiveQueueMonitor.tsx    # Real-time table
    │   │   └── UserPreferencesForm.tsx # Preference toggles
    │   └── hooks/
    │       └── useNotificationData.ts  # WS + REST data hook
    └── ...
```
