import { useState, useEffect, useCallback } from 'react';
import {
  User, MessageSquare, Mail, Smartphone, Globe, Monitor,
  Save, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  Shield, Bell, BellOff, Sliders,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────

interface ChannelPreference {
  channel:               string;
  is_enabled:            boolean;
  transactional_enabled: boolean;
  promotional_enabled:   boolean;
  alert_enabled:         boolean;
  regulatory_enabled:    boolean;
  quiet_hours_override:  boolean;
  updated_at?:           string;
}

interface UserData {
  id:                string;
  external_id:       string;
  full_name:         string;
  email:             string;
  phone:             string;
  timezone:          string;
  locale:            string;
  is_dnd_registered: boolean;
}

interface PreferencesResponse {
  user:        UserData;
  preferences: ChannelPreference[];
}

const API_BASE = import.meta.env['VITE_API_URL'] ?? '';

// ─── Channel config ───────────────────────────────────────────

const CHANNELS = [
  { key: 'SMS',      label: 'SMS',       icon: MessageSquare, color: '#38bdf8' },
  { key: 'EMAIL',    label: 'Email',     icon: Mail,          color: '#a78bfa' },
  { key: 'PUSH',     label: 'Push',      icon: Smartphone,    color: '#fb923c' },
  { key: 'WHATSAPP', label: 'WhatsApp',  icon: Globe,         color: '#34d399' },
  { key: 'INAPP',    label: 'In-App',    icon: Monitor,       color: '#22d3ee' },
] as const;

const CATEGORY_LABELS = [
  { key: 'transactional_enabled', label: 'Transactional',  sub: 'Payments, transfers, alerts', color: '#10b981', alwaysOn: true },
  { key: 'promotional_enabled',   label: 'Promotional',    sub: 'Offers, campaigns, insights', color: '#f59e0b' },
  { key: 'alert_enabled',         label: 'Risk Alerts',    sub: 'Margin shortfall, stop-loss',  color: '#ef4444' },
  { key: 'regulatory_enabled',    label: 'Regulatory',     sub: 'KYC, tax notices, compliance', color: '#8b5cf6', alwaysOn: true },
] as const;

const DEMO_USERS = [
  { id: 'USR001', name: 'Arjun Sharma'  },
  { id: 'USR002', name: 'Priya Nair'   },
  { id: 'USR003', name: 'Ravi Krishnan'},
  { id: 'USR004', name: 'Sneha Patel'  },
  { id: 'USR005', name: 'Deepak Reddy' },
];

// ─── Toggle Component ─────────────────────────────────────────

function Toggle({
  id,
  checked,
  onChange,
  disabled = false,
  color    = '#6366f1',
}: {
  id:        string;
  checked:   boolean;
  onChange:  (v: boolean) => void;
  disabled?: boolean;
  color?:    string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-all duration-200
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${checked ? 'shadow-sm' : 'bg-slate-700'}`}
      style={checked ? { background: `linear-gradient(135deg, ${color}cc, ${color})` } : undefined}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow
          transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  );
}

// ─── Notification Toast ───────────────────────────────────────

function Toast({
  type,
  message,
}: {
  type:    'success' | 'error' | 'warning';
  message: string;
}) {
  const config = {
    success: { icon: CheckCircle, color: '#10b981', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    error:   { icon: XCircle,     color: '#ef4444', bg: 'bg-red-500/10 border-red-500/30'         },
    warning: { icon: AlertTriangle, color: '#f59e0b', bg: 'bg-amber-500/10 border-amber-500/30'   },
  }[type];

  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm animate-slide-in ${config.bg}`}>
      <Icon size={16} style={{ color: config.color }} />
      <span style={{ color: config.color }}>{message}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export function UserPreferencesForm() {
  const [userId, setUserId]       = useState('USR001');
  const [userData, setUserData]   = useState<UserData | null>(null);
  const [prefs, setPrefs]         = useState<ChannelPreference[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState<string | null>(null);
  const [toast, setToast]         = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [activeChannel, setActiveChannel] = useState<string>('SMS');

  const showToast = (type: 'success' | 'error' | 'warning', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Mock data for demo ──────────────────────────────────
  const generateMockPrefs = useCallback((): ChannelPreference[] =>
    CHANNELS.map(ch => ({
      channel:               ch.key,
      is_enabled:            true,
      transactional_enabled: true,
      promotional_enabled:   Math.random() > 0.5,
      alert_enabled:         true,
      regulatory_enabled:    true,
      quiet_hours_override:  ch.key === 'EMAIL',
      updated_at:            new Date().toISOString(),
    })), []);

  const generateMockUser = useCallback((id: string): UserData => {
    const user = DEMO_USERS.find(u => u.id === id) ?? DEMO_USERS[0]!;
    return {
      id:                id,
      external_id:       id,
      full_name:         user.name,
      email:             `${user.name.toLowerCase().replace(' ', '.')}@example.com`,
      phone:             `+91${Math.floor(9_000_000_000 + Math.random() * 999_999_999)}`,
      timezone:          'Asia/Kolkata',
      locale:            ['en', 'hi', 'ta', 'mr', 'te'][Math.floor(Math.random() * 5)] ?? 'en',
      is_dnd_registered: Math.random() > 0.7,
    };
  }, []);

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/${userId}/preferences`);
      if (res.ok) {
        const data = await res.json() as PreferencesResponse;
        setUserData(data.user);
        setPrefs(data.preferences);
      } else {
        throw new Error('API unavailable');
      }
    } catch {
      // Demo fallback
      setUserData(generateMockUser(userId));
      setPrefs(generateMockPrefs());
    } finally {
      setLoading(false);
    }
  }, [userId, generateMockPrefs, generateMockUser]);

  useEffect(() => {
    void fetchPreferences();
  }, [fetchPreferences]);

  const updateChannelPref = (channel: string, field: keyof ChannelPreference, value: boolean) => {
    setPrefs(prev => prev.map(p =>
      p.channel === channel ? { ...p, [field]: value } : p,
    ));
  };

  const savePreference = useCallback(async (channel: string) => {
    const pref = prefs.find(p => p.channel === channel);
    if (!pref) return;

    setSaving(channel);
    try {
      const res = await fetch(`${API_BASE}/api/users/${userId}/preferences`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          channel:               pref.channel,
          is_enabled:            pref.is_enabled,
          transactional_enabled: pref.transactional_enabled,
          promotional_enabled:   pref.promotional_enabled,
          alert_enabled:         pref.alert_enabled,
          regulatory_enabled:    pref.regulatory_enabled,
          quiet_hours_override:  pref.quiet_hours_override,
        }),
      });
      if (res.ok) {
        showToast('success', `${channel} preferences saved successfully`);
      } else {
        throw new Error('Save failed');
      }
    } catch {
      // Demo mode
      showToast('success', `${channel} preferences saved (demo mode)`);
    } finally {
      setSaving(null);
    }
  }, [prefs, userId]);

  const currentPref = prefs.find(p => p.channel === activeChannel);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Sliders size={16} className="text-brand-violet" />
          User Preference Configuration
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Manage per-channel notification delivery preferences and DND category opt-ins
        </p>
      </div>

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && <Toast type={toast.type} message={toast.message} />}

      {/* ── User Selector ──────────────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              User ID
            </label>
            <select
              id="user-id-select"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="input-field"
            >
              {DEMO_USERS.map(u => (
                <option key={u.id} value={u.id}>{u.id} — {u.name}</option>
              ))}
            </select>
          </div>
          <button
            id="btn-load-preferences"
            onClick={() => void fetchPreferences()}
            disabled={loading}
            className="btn-secondary"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading...' : 'Load Preferences'}
          </button>
        </div>

        {/* User Card */}
        {userData && !loading && (
          <div className="mt-4 p-3 rounded-xl bg-surface-hover border border-surface-border animate-fade-slide-in">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-purple to-brand-indigo
                              flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-white">{userData.full_name}</div>
                  {userData.is_dnd_registered && (
                    <span className="badge bg-red-500/10 text-red-400 border border-red-500/30 text-[10px]">
                      <Shield size={8} /> DND Registered
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{userData.email}</div>
                <div className="text-xs text-slate-400">{userData.phone} · {userData.timezone} · {userData.locale.toUpperCase()}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">External ID</div>
                <div className="font-mono text-sm text-slate-300">{userData.external_id}</div>
              </div>
            </div>

            {userData.is_dnd_registered && (
              <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400 flex items-start gap-2">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <div>
                  <strong>TRAI DND Registered:</strong> Promotional SMS/WhatsApp messages will be automatically blocked.
                  Transactional and regulatory communications remain exempt and will be delivered.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Channel Tabs ───────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {CHANNELS.map(ch => {
          const Icon = ch.icon;
          const pref = prefs.find(p => p.channel === ch.key);
          const isActive = activeChannel === ch.key;
          return (
            <button
              key={ch.key}
              id={`tab-channel-${ch.key.toLowerCase()}`}
              onClick={() => setActiveChannel(ch.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive
                  ? 'text-white shadow-sm'
                  : 'bg-surface-hover text-slate-400 hover:text-white border border-surface-border'}`}
              style={isActive ? {
                background: `linear-gradient(135deg, ${ch.color}30, ${ch.color}15)`,
                border:     `1px solid ${ch.color}50`,
                color:      ch.color,
              } : undefined}
            >
              <Icon size={14} />
              {ch.label}
              {pref && (
                <div className={`w-1.5 h-1.5 rounded-full ${pref.is_enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Channel Preferences Panel ───────────────────────── */}
      {currentPref && (
        <div className="card p-4 animate-fade-slide-in">
          {(() => {
            const chConfig = CHANNELS.find(c => c.key === activeChannel);
            const Icon = chConfig?.icon ?? MessageSquare;
            return (
              <>
                {/* Channel header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: `${chConfig?.color ?? '#64748b'}20`, border: `1px solid ${chConfig?.color ?? '#64748b'}40` }}>
                      <Icon size={14} style={{ color: chConfig?.color }} />
                    </div>
                    <div>
                      <div className="font-bold text-white text-base">{chConfig?.label} Notifications</div>
                      <div className="text-xs text-slate-500">Channel-level delivery configuration</div>
                    </div>
                  </div>

                  {/* Master enable toggle */}
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-slate-400">
                      {currentPref.is_enabled ? (
                        <span className="flex items-center gap-1.5 text-emerald-400">
                          <Bell size={14} /> Enabled
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <BellOff size={14} /> Disabled
                        </span>
                      )}
                    </div>
                    <Toggle
                      id={`toggle-${activeChannel}-master`}
                      checked={currentPref.is_enabled}
                      onChange={(v) => updateChannelPref(activeChannel, 'is_enabled', v)}
                      color={chConfig?.color}
                    />
                  </div>
                </div>

                {/* Category toggles */}
                <div className="space-y-4 mb-6">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Category Preferences
                  </div>
                  {CATEGORY_LABELS.map(cat => (
                    <div key={cat.key}
                      className={`flex items-center justify-between p-4 rounded-xl border transition-all duration-200
                        ${!currentPref.is_enabled ? 'opacity-40' : 'hover:border-surface-hover/80'}
                        bg-surface-hover border-surface-border`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
                          <span className="text-sm font-medium text-white">{cat.label}</span>
                          {'alwaysOn' in cat && cat.alwaysOn && (
                            <span className="badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px]">
                              Always On
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 ml-4">{cat.sub}</div>
                      </div>
                      <Toggle
                        id={`toggle-${activeChannel}-${cat.key}`}
                        checked={currentPref[cat.key] as boolean}
                        onChange={(v) => updateChannelPref(activeChannel, cat.key, v)}
                        disabled={!currentPref.is_enabled || ('alwaysOn' in cat && cat.alwaysOn)}
                        color={cat.color}
                      />
                    </div>
                  ))}
                </div>

                {/* Quiet hours override */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-surface-hover border border-surface-border mb-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-cyan-400" />
                      <span className="text-sm font-medium text-white">Override Quiet Hours</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 ml-5.5">
                      Allow {chConfig?.label} notifications during quiet hours (21:00–08:00 IST)
                    </div>
                  </div>
                  <Toggle
                    id={`toggle-${activeChannel}-quiet-hours`}
                    checked={currentPref.quiet_hours_override}
                    onChange={(v) => updateChannelPref(activeChannel, 'quiet_hours_override', v)}
                    disabled={!currentPref.is_enabled}
                    color="#06b6d4"
                  />
                </div>

                {/* Save button */}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Last updated:{' '}
                    {currentPref.updated_at
                      ? new Date(currentPref.updated_at).toLocaleString('en-IN')
                      : 'Never'}
                  </div>
                  <button
                    id={`btn-save-${activeChannel.toLowerCase()}`}
                    onClick={() => void savePreference(activeChannel)}
                    disabled={!!saving}
                    className="btn-primary"
                  >
                    {saving === activeChannel ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {saving === activeChannel ? 'Saving...' : 'Save Preferences'}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── All Channels Summary ──────────────────────────── */}
      <div className="card p-3">
        <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
          <Sliders size={14} className="text-slate-400" />
          All Channels Overview
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {CHANNELS.map(ch => {
            const pref = prefs.find(p => p.channel === ch.key);
            const Icon = ch.icon;
            if (!pref) return null;
            return (
              <div
                key={ch.key}
                onClick={() => setActiveChannel(ch.key)}
                className="p-3 rounded-xl border cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
                style={{
                  background: `${ch.color}08`,
                  borderColor: activeChannel === ch.key ? ch.color : 'rgba(42,42,74,0.8)',
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <Icon size={16} style={{ color: ch.color }} />
                  <div className={`w-2 h-2 rounded-full ${pref.is_enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                </div>
                <div className="text-xs font-semibold text-white mb-2">{ch.label}</div>
                <div className="space-y-1">
                  {CATEGORY_LABELS.map(cat => (
                    <div key={cat.key} className="flex items-center gap-1.5">
                      <div className={`w-1 h-1 rounded-full ${(pref[cat.key] as boolean) ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      <span className="text-[10px] text-slate-500">{cat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
