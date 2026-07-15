import { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadialBarChart, RadialBar, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, CheckCircle, XCircle, AlertTriangle,
  MessageSquare, Mail, Smartphone, Globe, Monitor,
  BarChart2, Clock, Activity, Layers,
} from 'lucide-react';
import type { NotificationSummary } from '../hooks/useNotificationData';

// ─── Types ─────────────────────────────────────────────────────

interface DashboardStatsProps {
  summary:       NotificationSummary | null;
  showAnalytics?: boolean;
}

// ─── Channel Icons ────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, any> = {
  SMS:      MessageSquare,
  EMAIL:    Mail,
  PUSH:     Smartphone,
  WHATSAPP: Globe,
  INAPP:    Monitor,
};

const CHANNEL_COLORS: Record<string, string> = {
  SMS:      '#38bdf8',
  EMAIL:    '#a78bfa',
  PUSH:     '#fb923c',
  WHATSAPP: '#34d399',
  INAPP:    '#22d3ee',
};

const STATUS_COLORS: Record<string, string> = {
  DELIVERED:     '#10b981',
  SENT:          '#06b6d4',
  QUEUED:        '#f59e0b',
  FAILED:        '#ef4444',
  DEAD_LETTERED: '#dc2626',
  ENRICHED:      '#3b82f6',
  ROUTED:        '#8b5cf6',
};

// ─── Mock throughput data for charts ─────────────────────────

function generateThroughputData() {
  return Array.from({ length: 24 }, (_, i) => {
    const hour = `${String(i).padStart(2, '0')}:00`;
    const base  = i >= 9 && i <= 17 ? 60 : i >= 18 && i <= 20 ? 40 : 15;
    return {
      hour,
      delivered: Math.floor(base + Math.random() * base * 0.5),
      failed:    Math.floor(Math.random() * 5),
      total:     Math.floor(base * 1.1 + Math.random() * base * 0.5),
    };
  });
}

function generateLatencyData() {
  const channels = ['SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP'];
  return channels.map(channel => ({
    channel,
    p50:  Math.floor(50  + Math.random() * 100),
    p95:  Math.floor(200 + Math.random() * 400),
    p99:  Math.floor(500 + Math.random() * 1000),
  }));
}

// ─── Metric Card ─────────────────────────────────────────────

interface MetricCardProps {
  label:    string;
  value:    string | number;
  sub?:     string;
  icon:     any;
  color:    string;
  trend?:   number;
  suffix?:  string;
}

function MetricCard({ label, value, sub, icon: Icon, color, trend, suffix }: MetricCardProps) {
  return (
    <div className="card card-hover p-4 relative overflow-hidden group flex flex-col justify-between h-[100px]">
      {/* Background glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at top right, ${color}15 0%, transparent 70%)` }}
      />

      <div className="relative z-10 flex items-start justify-between w-full">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
            style={{ background: `${color}20`, border: `1px solid ${color}40` }}
          >
            <Icon size={16} style={{ color }} />
          </div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded
            ${trend >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            <TrendingUp size={10} className={trend < 0 ? 'rotate-180' : ''} />
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      
      <div className="relative z-10 flex items-end justify-between w-full mt-2">
        <div className="text-2xl font-black text-white leading-none font-mono">
          {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
          {suffix && <span className="text-sm ml-1 text-slate-400">{suffix}</span>}
        </div>
        {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Tooltip Formatters ───────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?:   string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card p-3 text-xs space-y-1 min-w-[140px]">
      <div className="text-slate-400 font-semibold mb-2">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="text-white font-mono">{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export function DashboardStats({ summary, showAnalytics = false }: DashboardStatsProps) {
  const throughputData  = useMemo(generateThroughputData, []);
  const latencyData     = useMemo(generateLatencyData, []);

  const s = summary?.summary;

  const metricCards: MetricCardProps[] = [
    { label: 'Total', value: s?.total ?? 0, sub: '24h Vol', icon: Activity, color: '#6366f1', trend: 12 },
    { label: 'Delivered', value: s?.delivered ?? 0, sub: `${s?.successRate ?? 0}% Rate`, icon: CheckCircle, color: '#10b981', trend: 3 },
    { label: 'Failed', value: s?.failed ?? 0, sub: 'Retries/DLQ', icon: XCircle, color: '#ef4444', trend: -8 },
    { label: 'DLQ', value: s?.dead_lettered ?? 0, sub: 'Action Req', icon: AlertTriangle, color: '#f59e0b', trend: -2 },
    { label: 'Success', value: s?.successRate ?? 0, sub: 'Goal: 98%', icon: BarChart2, color: '#7c3aed', suffix: '%', trend: 1 },
    { label: 'Latency', value: 156, sub: 'Avg time', icon: Clock, color: '#06b6d4', suffix: 'ms', trend: -5 },
  ];

  const channelData = summary?.byChannel ?? [];
  const statusData  = summary?.byStatus  ?? [];
  const pieColors = statusData.map(s => STATUS_COLORS[s.status] ?? '#64748b');

  return (
    <div className="flex flex-col gap-6 w-full pb-12">
      
      {/* ── KPI Row (Full Width Grid) ──────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 w-full">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      {/* ── 1. Notification Throughput ───────────────────────── */}
      <div className="card p-6 flex flex-col w-full h-[400px]">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Throughput (24h Volume)</h2>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-emerald-400 inline-block rounded" /> Delivered</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-red-400 inline-block rounded" /> Failed</span>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={throughputData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,42,74,0.6)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} interval={2} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#10b981" strokeWidth={2} fill="url(#gradDelivered)" dot={false} />
                <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} fill="url(#gradFailed)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Delivery Latency ──────────────────────────────── */}
      <div className="card p-6 flex flex-col w-full h-[400px]">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Latency Distributions</h2>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-2 h-1.5 rounded bg-indigo-500" /><span className="text-slate-400">P50 (ms)</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-1.5 rounded bg-amber-500" /><span className="text-slate-400">P95 (ms)</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-1.5 rounded bg-red-500" /><span className="text-slate-400">P99 (ms)</span></div>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,42,74,0.6)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} domain={[0, 1600]} />
                <YAxis dataKey="channel" type="category" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="p50" name="P50" radius={[0, 3, 3, 0]} fill="#6366f1" barSize={6} />
                <Bar dataKey="p95" name="P95" radius={[0, 3, 3, 0]} fill="#f59e0b" barSize={6} />
                <Bar dataKey="p99" name="P99" radius={[0, 3, 3, 0]} fill="#ef4444" barSize={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. Channel Performance ───────────────────────────── */}
      <div className="card p-6 flex flex-col w-full h-[400px]">
          <div className="mb-4 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Channel Utilization</h2>
          </div>
          <div className="flex-1 min-h-0 relative mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,42,74,0.6)" vertical={false} />
                <XAxis dataKey="channel" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Sent" radius={[4, 4, 0, 0]} fill="#6366f1" barSize={16} />
                <Bar dataKey="delivered" name="Delivered" radius={[4, 4, 0, 0]} fill="#10b981" barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 flex-shrink-0 justify-center">
            {channelData.map(ch => {
              const Icon = CHANNEL_ICONS[ch.channel] ?? MessageSquare;
              const rate = ch.count > 0 ? Math.round((ch.delivered / ch.count) * 100) : 0;
              return (
                <div key={ch.channel} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold" style={{ background: `${CHANNEL_COLORS[ch.channel] ?? '#64748b'}15`, color: CHANNEL_COLORS[ch.channel] ?? '#64748b' }}>
                  <Icon size={16} />
                  <span>{rate}%</span>
                </div>
              );
            })}
          </div>
        </div>
      {/* Status Breakdown Pie ────────────────────────────── */}
      <div className="card p-6 flex flex-col w-full h-[400px]">
          <div className="mb-4 flex-shrink-0">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Status Distribution</h2>
          </div>
          <div className="flex-1 min-h-0 relative mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="count" nameKey="status" paddingAngle={2}>
                  {statusData.map((_, index) => (
                    <Cell key={index} fill={pieColors[index] ?? '#64748b'} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number, name: string) => [value.toLocaleString(), name]} contentStyle={{ background: '#1e1e38', border: '1px solid #2a2a4a', borderRadius: 8, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-3 mt-4">
            {statusData.slice(0, 6).map((s, i) => (
              <div key={s.status} className="flex items-center justify-between text-sm bg-surface-hover/30 px-3 py-2 rounded-lg">
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: pieColors[i] }} />
                  <span className="text-slate-400 truncate">{s.status}</span>
                </div>
                <span className="text-white font-mono font-bold ml-3">{s.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

      {/* Recent Activity Table ───────────────────────────── */}
      <div className="card overflow-hidden flex flex-col w-full h-[500px]">
          <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between flex-shrink-0 bg-surface-card sticky top-0 z-10">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
              <Layers size={16} className="text-brand-violet" />
              Recent System Activity
            </h2>
          </div>
          <div className="overflow-y-auto overflow-x-auto flex-1 p-2">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead className="sticky top-0 bg-surface-card z-10">
                <tr className="text-xs text-slate-400 uppercase tracking-wider border-b border-surface-border">
                  <th className="pb-3 px-4 font-semibold">Event Type</th>
                  <th className="pb-3 px-4 font-semibold">User</th>
                  <th className="pb-3 px-4 font-semibold">Channel</th>
                  <th className="pb-3 px-4 font-semibold">Status</th>
                  <th className="pb-3 px-4 font-semibold text-right">Time</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {(summary?.recent ?? []).map((notif) => (
                  <tr key={notif.id} className="border-b border-surface-border/50 last:border-0 hover:bg-surface-hover/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs bg-surface-hover px-2 py-1 rounded-md text-slate-300">
                        {notif.event_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300 truncate max-w-[200px] font-medium">{notif.user_name}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded font-bold text-xs bg-slate-800/50 text-${notif.channel.toLowerCase() === 'sms' ? 'sky' : notif.channel.toLowerCase() === 'email' ? 'purple' : 'orange'}-400`}>
                        {notif.channel}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded font-bold text-xs bg-slate-800/50 ${notif.status === 'DELIVERED' ? 'text-emerald-400' : notif.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}`}>
                        {notif.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-right whitespace-nowrap text-xs font-mono">
                      {new Date(notif.created_at).toLocaleTimeString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}
