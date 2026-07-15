const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/api/analytics/summary') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      summary: { total: 1500, delivered: 1350, failed: 120, dead_lettered: 30, successRate: 90 },
      byChannel: [
        { channel: 'SMS', count: 500, delivered: 450 },
        { channel: 'EMAIL', count: 400, delivered: 380 },
        { channel: 'PUSH', count: 300, delivered: 290 },
        { channel: 'WHATSAPP', count: 200, delivered: 150 },
        { channel: 'INAPP', count: 100, delivered: 80 }
      ],
      byStatus: [
        { status: 'DELIVERED', count: 1350 },
        { status: 'SENT', count: 50 },
        { status: 'QUEUED', count: 20 },
        { status: 'FAILED', count: 120 },
        { status: 'DEAD_LETTERED', count: 30 }
      ],
      recent: Array.from({ length: 15 }, (_, i) => ({
        id: `msg-${i}`,
        tracking_id: `TRK-00${i}`,
        event_type: ['TXNX-001', 'RISK-002', 'MKTX-001'][i % 3],
        channel: ['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP'][i % 5],
        status: ['DELIVERED', 'FAILED', 'QUEUED'][i % 3],
        priority: 1,
        created_at: new Date(Date.now() - i * 60000).toISOString(),
        user_name: 'System User'
      }))
    }));
  } else {
    res.writeHead(200); res.end('Mock Server');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('Client connected to mock WS');
  ws.send(JSON.stringify({ type: 'CONNECTED' }));

  const interval = setInterval(() => {
    ws.send(JSON.stringify({
      type: 'STATE_UPDATE',
      notificationId: Math.random().toString(36).slice(2, 10),
      trackingId: `TRK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      eventType: 'TXNX-001',
      channel: 'SMS',
      status: 'DELIVERED',
      timestamp: new Date().toISOString()
    }));
  }, 2000);

  ws.on('close', () => clearInterval(interval));
});

server.listen(3000, () => {
  console.log('Mock Backend Server running on port 3000');
});
