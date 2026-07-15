import { useEffect, useRef, useState } from 'react';
import {
  MessageSquare, Mail, Smartphone, Globe, Monitor,
  Wifi, WifiOff, Clock, Filter, Search, RefreshCw,
} from 'lucide-react';
import type { QueueMessage } from '../hooks/useNotificationData';

// ─── Types ─────────────────────────────────────────────────────

interface LiveQueueMonitorProps {
  messages:    QueueMessage[];
  isConnected: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, any> = {
  SMS:      MessageSquare,
  EMAIL:    Mail,
  PUSH:     Smartphone,
  WHATSAPP: Globe,
  INAPP:    Monitor,
};

function getChannelClass(channel: string): string {
  return `channel-${channel.toLowerCase()}`;
}

function getStatusClass(status: string): string {
  return `status-${status.toLowerCase().replace(/_/g, '-')}`;
}

function getEventTypeColor(eventType: string): string {
  const prefix = eventType.split('-')[0] ?? '';
  const map: Record<string, string> = {
    TXNX: 'text-sky-400 bg-sky-500/10',
    SIPX: 'text-violet-400 bg-violet-500/10',
    MKTX: 'text-orange-400 bg-orange-500/10',
    RISK: 'text-red-400 bg-red-500/10',
    REGX: 'text-emerald-400 bg-emerald-500/10',
  };
  return map[prefix] ?? 'text-slate-400 bg-slate-500/10';
}

function getPriorityDisplay(priority: number): { label: string; class: string } {
  if (priority <= 2) return { label: 'CRITICAL', class: 'text-red-400 bg-red-500/10 border border-red-500/30' };
  if (priority <= 4) return { label: 'HIGH',     class: 'text-amber-400 bg-amber-500/10 border border-amber-500/30' };
  if (priority <= 6) return { label: 'MEDIUM',   class: 'text-blue-400 bg-blue-500/10 border border-blue-500/30' };
  return { label: 'LOW', class: 'text-slate-400 bg-slate-500/10 border border-slate-500/30' };
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 1000)      return 'just now';
  if (diff < 60_000)    return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ─── Status Dot ──────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    CREATED:       'bg-slate-400',
    ENRICHED:      'bg-blue-400',
    ROUTED:        'bg-purple-400',
    QUEUED:        'bg-amber-400 animate-pulse',
    SENT:          'bg-cyan-400',
    DELIVERED:     'bg-emerald-400',
    READ:          'bg-green-400',
    FAILED:        'bg-red-400 animate-pulse',
    DEAD_LETTERED: 'bg-rose-600 animate-pulse',
  };
  return (
    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colorMap[status] ?? 'bg-slate-400'}`} />
  );
}

// ─── Main Component ───────────────────────────────────────────

export function LiveQueueMonitor({ messages, isConnected }: LiveQueueMonitorProps) {
  const tableRef      = useRef<HTMLDivElement>(null);
  const [filter, setFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [autoScroll, setAutoScroll]  = useState(true);
  const [newCount, setNewCount]    = useState(0);
  const prevMsgCount = useRef(messages.length);

  // Track new messages for badge
  useEffect(() => {
    const diff = messages.length - prevMsgCount.current;
    if (diff > 0) {
      setNewCount(c => c + diff);
      const t = setTimeout(() => setNewCount(0), 3000);
      return () => clearTimeout(t);
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  // Auto-scroll to top for new messages
  useEffect(() => {
    if (autoScroll && tableRef.current) {
      tableRef.current.scrollTop = 0;
    }
  }, [messages, autoScroll]);

  // Filter logic
  const filtered = messages.filter(msg => {
    const matchText = !filter ||
      msg.eventType.toLowerCase().includes(filter.toLowerCase()) ||
      (msg.trackingId ?? '').toLowerCase().includes(filter.toLowerCase()) ||
      (msg.userName ?? '').toLowerCase().includes(filter.toLowerCase());
    const matchStatus  = statusFilter  === 'ALL' || msg.status  === statusFilter;
    const matchChannel = channelFilter === 'ALL' || msg.channel === channelFilter;
    return matchText && matchStatus && matchChannel;
  });

  const STATUSES  = ['ALL', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'DEAD_LETTERED'];
  const CHANNELS  = ['ALL', 'SMS', 'EMAIL', 'PUSH', 'WHATSAPP', 'INAPP'];

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Live Queue Monitor
              {newCount > 0 && (
                <span className="badge bg-brand-violet/20 text-brand-violet border border-brand-violet/30 animate-bounce-in">
                  +{newCount} new
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {filtered.length} of {messages.length} notifications
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Status */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
            ${isConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isConnected ? 'WebSocket Live' : 'Polling Mode'}
          </div>

          {/* Auto-scroll toggle */}
          <button
            id="btn-auto-scroll"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
              ${autoScroll
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                : 'bg-surface-hover text-slate-400 border-surface-border'}`}
          >
            <RefreshCw size={11} className={autoScroll ? 'animate-spin' : ''} style={{ animationDuration: '3s' }} />
            Auto-scroll
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              id="queue-search"
              type="text"
              placeholder="Search event type, tracking ID, user..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="input-field pl-9"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-slate-500" />
            <div className="flex gap-1">
              {STATUSES.map(s => (
                <button
                  key={s}
                  id={`filter-status-${s.toLowerCase()}`}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
                    ${statusFilter === s
                      ? 'bg-brand-purple text-white'
                      : 'bg-surface-hover text-slate-400 hover:text-white'}`}
                >
                  {s === 'ALL' ? 'All Status' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Channel filter */}
          <div className="flex gap-1">
            {CHANNELS.map(ch => {
              const Icon = ch !== 'ALL' ? (CHANNEL_ICONS[ch] ?? MessageSquare) : null;
              return (
                <button
                  key={ch}
                  id={`filter-channel-${ch.toLowerCase()}`}
                  onClick={() => setChannelFilter(ch)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all
                    ${channelFilter === ch
                      ? 'bg-brand-indigo text-white'
                      : 'bg-surface-hover text-slate-400 hover:text-white'}`}
                >
                  {Icon && <Icon size={11} />}
                  {ch}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────── */}
      <div className="card overflow-hidden flex flex-col max-h-[500px]">
        {/* Sticky header */}
        <div className="px-3 py-2 border-b border-surface-border bg-surface-card/80 backdrop-blur-sm
                        flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock size={12} />
            <span>Updates every 2 seconds in demo mode</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
            <span className="text-xs text-slate-500">
              {isConnected ? 'Real-time' : 'Simulated'}
            </span>
          </div>
        </div>

        <div ref={tableRef} className="overflow-y-auto flex-1 p-2">
          <table className="data-table">
            <thead className="sticky top-0 z-10 bg-surface-card">
              <tr>
                <th style={{ width: 24 }} />
                <th>Tracking ID</th>
                <th>Event Type</th>
                <th>User</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    No notifications match your filters
                  </td>
                </tr>
              )}
              {filtered.map((msg, idx) => {
                const ChannelIcon = CHANNEL_ICONS[msg.channel] ?? MessageSquare;
                const priority    = getPriorityDisplay(msg.priority);
                return (
                  <tr
                    key={`${msg.id}-${idx}`}
                    className={`${msg.isNew ? 'animate-slide-in' : ''} transition-all duration-300`}
                  >
                    <td>
                      <StatusDot status={msg.status} />
                    </td>
                    <td>
                      <span className="font-mono text-xs text-slate-400">
                        {msg.trackingId?.slice(0, 12) ?? msg.id.slice(0, 12)}…
                      </span>
                    </td>
                    <td>
                      <span className={`font-mono text-xs px-2 py-0.5 rounded font-semibold ${getEventTypeColor(msg.eventType)}`}>
                        {msg.eventType}
                      </span>
                    </td>
                    <td className="text-slate-300 text-sm">{msg.userName ?? '—'}</td>
                    <td>
                      <span className={`badge ${getChannelClass(msg.channel)} flex items-center gap-1`}>
                        <ChannelIcon size={10} />
                        {msg.channel}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${getStatusClass(msg.status)}`}>
                        {msg.status}
                      </span>
                    </td>
                    <td>
                      <span className={`badge text-[10px] ${priority.class}`}>
                        {priority.label}
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs whitespace-nowrap">
                      {formatRelativeTime(msg.timestamp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-surface-border bg-surface-card/50
                        flex items-center justify-between text-xs text-slate-500 flex-shrink-0">
          <span>Showing {filtered.length} of {messages.length} messages (last 100 kept)</span>
          <span className="flex items-center gap-1">
            <Clock size={11} />
            Last updated: {new Date().toLocaleTimeString('en-IN')}
          </span>
        </div>
      </div>

      {/* ── State Machine Lifecycle Legend ──────────────────── */}
      <div className="card p-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Notification Lifecycle (State Machine)
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[
            { state: 'CREATED',   color: '#64748b' },
            { state: 'ENRICHED',  color: '#3b82f6' },
            { state: 'ROUTED',    color: '#8b5cf6' },
            { state: 'QUEUED',    color: '#f59e0b' },
            { state: 'SENT',      color: '#06b6d4' },
            { state: 'DELIVERED', color: '#10b981' },
            { state: 'READ',      color: '#22c55e' },
            { state: 'FAILED',    color: '#ef4444' },
          ].map((s, i, arr) => (
            <div key={s.state} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span style={{ color: s.color }} className="font-medium">{s.state}</span>
              {i < arr.length - 2 && (
                <span className="text-slate-600 mx-0.5">→</span>
              )}
              {i === arr.length - 2 && (
                <span className="text-slate-600 mx-0.5 ml-2">|</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
