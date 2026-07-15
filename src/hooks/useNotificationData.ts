import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ─────────────────────────────────────────────────────

export interface NotificationSummary {
  summary: {
    total:       number;
    delivered:   number;
    failed:      number;
    dead_lettered: number;
    successRate: number;
  };
  byChannel: Array<{ channel: string; count: number; delivered: number }>;
  byStatus:  Array<{ status: string; count: number }>;
  recent:    RecentNotification[];
}

export interface ThroughputDataPoint {
  hour:       string;
  total:      number;
  delivered:  number;
  failed:     number;
  channel:    string;
}

export interface QueueMessage {
  id:         string;
  trackingId: string;
  eventType:  string;
  channel:    string;
  status:     string;
  priority:   number;
  userName?:  string;
  timestamp:  string;
  isNew?:     boolean;
}

export interface RecentNotification {
  id:          string;
  tracking_id: string;
  event_type:  string;
  channel:     string;
  status:      string;
  priority:    number;
  created_at:  string;
  user_name:   string;
}

const API_BASE = import.meta.env['VITE_API_URL'] ?? '';
const WS_URL   = (import.meta.env['VITE_WS_URL'] ?? 'ws://localhost:3000') + '/ws';

// ─── Mock Data Generator (for offline/demo mode) ─────────────

const EVENT_TYPES = [
  'TXNX-001', 'TXNX-002', 'TXNX-003', 'TXNX-004',
  'SIPX-001', 'SIPX-002', 'SIPX-003',
  'MKTX-001', 'MKTX-002', 'MKTX-004',
  'RISK-001', 'RISK-002', 'RISK-004',
  'REGX-001', 'REGX-002', 'REGX-004',
];
const CHANNELS  = ['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP'];
const STATUSES  = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'ENRICHED', 'ROUTED'];
const USERS     = ['Arjun Sharma', 'Priya Nair', 'Ravi Krishnan', 'Sneha Patel', 'Deepak Reddy'];

function generateMockMessage(id?: string): QueueMessage {
  return {
    id:         id ?? Math.random().toString(36).slice(2, 10),
    trackingId: `TRK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    eventType:  EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)]!,
    channel:    CHANNELS[Math.floor(Math.random() * CHANNELS.length)]!,
    status:     STATUSES[Math.floor(Math.random() * STATUSES.length)]!,
    priority:   Math.floor(Math.random() * 10) + 1,
    userName:   USERS[Math.floor(Math.random() * USERS.length)]!,
    timestamp:  new Date().toISOString(),
    isNew:      true,
  };
}

function generateMockSummary(): NotificationSummary {
  const total     = 1247 + Math.floor(Math.random() * 100);
  const delivered = Math.floor(total * (0.87 + Math.random() * 0.08));
  const failed    = Math.floor(total * (0.02 + Math.random() * 0.03));
  const dead      = Math.floor(total * 0.005);

  return {
    summary: {
      total,
      delivered,
      failed,
      dead_lettered: dead,
      successRate: Math.round((delivered / total) * 100),
    },
    byChannel: [
      { channel: 'SMS',      count: Math.floor(total * 0.3),  delivered: Math.floor(total * 0.27) },
      { channel: 'EMAIL',    count: Math.floor(total * 0.25), delivered: Math.floor(total * 0.23) },
      { channel: 'PUSH',     count: Math.floor(total * 0.2),  delivered: Math.floor(total * 0.19) },
      { channel: 'INAPP',    count: Math.floor(total * 0.15), delivered: Math.floor(total * 0.14) },
      { channel: 'WHATSAPP', count: Math.floor(total * 0.1),  delivered: Math.floor(total * 0.09) },
    ],
    byStatus: [
      { status: 'DELIVERED',    count: delivered },
      { status: 'SENT',         count: Math.floor(total * 0.05) },
      { status: 'QUEUED',       count: Math.floor(total * 0.03) },
      { status: 'FAILED',       count: failed },
      { status: 'DEAD_LETTERED', count: dead },
    ],
    recent: Array.from({ length: 15 }, (_, i) => ({
      id:          Math.random().toString(36).slice(2),
      tracking_id: `TRK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      event_type:  EVENT_TYPES[i % EVENT_TYPES.length]!,
      channel:     CHANNELS[i % CHANNELS.length]!,
      status:      STATUSES[Math.floor(Math.random() * STATUSES.length)]!,
      priority:    (i % 10) + 1,
      created_at:  new Date(Date.now() - i * 60_000).toISOString(),
      user_name:   USERS[i % USERS.length]!,
    })),
  };
}

// ─── Hook ─────────────────────────────────────────────────────

export function useNotificationData() {
  const [summary, setSummary]           = useState<NotificationSummary>(generateMockSummary());
  const [throughput, setThroughput]     = useState<ThroughputDataPoint[]>([]);
  const [queueMessages, setQueueMessages] = useState<QueueMessage[]>(
    () => Array.from({ length: 12 }, () => generateMockMessage()),
  );
  const [isConnected, setIsConnected]   = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const wsRef        = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number>(0);

  // ── WebSocket Connection ─────────────────────────────────
  const connectWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket(`${WS_URL}?userId=dashboard_operator`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type:           string;
            notificationId: string;
            trackingId:     string;
            eventType:      string;
            channel:        string;
            status:         string;
            timestamp:      string;
            userName?:      string;
          };

          if (msg.type === 'STATE_UPDATE') {
            const newMsg: QueueMessage = {
              id:         msg.notificationId,
              trackingId: msg.trackingId,
              eventType:  msg.eventType,
              channel:    msg.channel,
              status:     msg.status,
              priority:   5,
              userName:   msg.userName,
              timestamp:  msg.timestamp,
              isNew:      true,
            };

            setQueueMessages(prev => {
              const existing = prev.findIndex(m => m.id === msg.notificationId);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { ...updated[existing]!, status: msg.status, isNew: true };
                return updated;
              }
              return [newMsg, ...prev].slice(0, 100);
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(2, reconnectRef.current++), 30_000);
        setTimeout(connectWebSocket, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available in dev without backend
      setIsConnected(false);
    }
  }, []);

  // ── REST Polling ─────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/summary`);
      if (!res.ok) throw new Error('API unavailable');
      const data = await res.json() as NotificationSummary;
      setSummary(data);
    } catch {
      // Fallback to mock data when API is unavailable
      setSummary(prev => ({
        ...prev,
        summary: {
          ...prev.summary,
          total:     prev.summary.total + Math.floor(Math.random() * 5),
          delivered: prev.summary.delivered + Math.floor(Math.random() * 4),
        },
      }));
    }
  }, []);

  const fetchThroughput = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/throughput`);
      if (!res.ok) throw new Error('API unavailable');
      const data = await res.json() as { data: ThroughputDataPoint[] };
      setThroughput(data.data);
    } catch {
      // Generate mock throughput for demo
      const now = Date.now();
      const mockPoints: ThroughputDataPoint[] = Array.from({ length: 24 }, (_, i) => {
        const hour = new Date(now - (23 - i) * 3_600_000).toISOString();
        return {
          hour,
          total:     Math.floor(40 + Math.random() * 80),
          delivered: Math.floor(35 + Math.random() * 70),
          failed:    Math.floor(Math.random() * 8),
          channel:   'ALL',
        };
      });
      setThroughput(mockPoints);
    }
  }, []);

  // ── Mock live queue updates ───────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isConnected) {
        // Simulate live updates when WS is not connected
        const newMsg = generateMockMessage();
        setQueueMessages(prev => {
          // Randomly update an existing message or add new
          if (Math.random() < 0.4 && prev.length > 0) {
            const updated = [...prev];
            const idx     = Math.floor(Math.random() * Math.min(5, updated.length));
            const statuses = ['QUEUED', 'SENT', 'DELIVERED'] as const;
            const current  = updated[idx]!;
            updated[idx]   = {
              ...current,
              status: statuses[Math.floor(Math.random() * statuses.length)]!,
              isNew:  true,
            };
            return updated;
          }
          return [{ ...newMsg, isNew: true }, ...prev].slice(0, 100);
        });
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isConnected]);

  // ── Init ─────────────────────────────────────────────────
  useEffect(() => {
    connectWebSocket();
    void fetchSummary();
    void fetchThroughput();

    const summaryInterval    = setInterval(fetchSummary,    15_000);
    const throughputInterval = setInterval(fetchThroughput, 60_000);

    return () => {
      wsRef.current?.close();
      clearInterval(summaryInterval);
      clearInterval(throughputInterval);
    };
  }, [connectWebSocket, fetchSummary, fetchThroughput]);

  // ── Simulate Event ───────────────────────────────────────
  const simulateEvent = useCallback(async () => {
    setIsSimulating(true);
    try {
      const res = await fetch(`${API_BASE}/api/simulate-event`, { method: 'POST' });
      if (res.ok) {
        await fetchSummary();
      }
    } catch {
      // In demo mode, just add a fake message
      const newMsg = generateMockMessage();
      setQueueMessages(prev => [
        { ...newMsg, status: 'CREATED', isNew: true },
        ...prev,
      ].slice(0, 100));
    } finally {
      setTimeout(() => setIsSimulating(false), 1000);
    }
  }, [fetchSummary]);

  return {
    summary,
    throughput,
    queueMessages,
    isConnected,
    isSimulating,
    simulateEvent,
    refetchSummary: fetchSummary,
  };
}
