import { useState, useCallback } from 'react';
import {
  LayoutDashboard, Activity, Settings, Bell, Zap,
  ChevronRight, Database, GitBranch, Radio,
  TrendingUp, Shield,
} from 'lucide-react';
import { DashboardStats } from './components/DashboardStats';
import { LiveQueueMonitor } from './components/LiveQueueMonitor';
import { UserPreferencesForm } from './components/UserPreferencesForm';
import { useNotificationData } from './hooks/useNotificationData';

type ActiveView = 'dashboard' | 'queue' | 'preferences' | 'analytics';

interface NavItem {
  id:    ActiveView;
  label: string;
  icon:  React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',   label: 'Dashboard',      icon: LayoutDashboard },
  { id: 'queue',       label: 'Live Queue',      icon: Activity,        badge: 'LIVE' },
  { id: 'preferences', label: 'User Prefs',      icon: Settings },
  { id: 'analytics',   label: 'Analytics',       icon: TrendingUp },
];

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { summary, queueMessages, isConnected, simulateEvent, isSimulating } =
    useNotificationData();

  const handleSimulate = useCallback(async () => {
    await simulateEvent();
  }, [simulateEvent]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside
        className={`${sidebarOpen ? 'w-64' : 'w-16'} flex-shrink-0 flex flex-col
          bg-surface-card border-r border-surface-border transition-all duration-300 z-10`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-surface-border">
          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-brand-purple to-brand-indigo
                          flex items-center justify-center shadow-glow-purple">
            <Zap size={18} className="text-white" />
          </div>
          {sidebarOpen && (
            <div className="animate-fade-slide-in overflow-hidden">
              <div className="font-bold text-white text-base leading-tight">NotifEngine</div>
              <div className="text-xs text-slate-500">Financial Notifications</div>
            </div>
          )}
        </div>

        {/* Status Indicators */}
        {sidebarOpen && (
          <div className="px-4 py-3 border-b border-surface-border animate-fade-slide-in">
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`} />
              <span className="text-xs text-slate-400">
                {isConnected ? 'WebSocket Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs text-slate-400">
                {summary?.summary.total ?? 0} events today
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon  = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => setActiveView(item.id)}
                className={`w-full sidebar-link ${active ? 'sidebar-link-active' : ''}`}
              >
                <Icon size={18} className={active ? 'text-brand-violet' : ''} />
                {sidebarOpen && (
                  <span className="flex-1 text-left animate-fade-slide-in">{item.label}</span>
                )}
                {sidebarOpen && item.badge && (
                  <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px]">
                    {item.badge}
                  </span>
                )}
                {active && sidebarOpen && (
                  <ChevronRight size={14} className="text-brand-violet ml-auto" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="px-3 py-4 border-t border-surface-border space-y-2">
          {/* System Status */}
          {sidebarOpen && (
            <div className="card p-3 text-xs space-y-1.5 animate-fade-slide-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Database size={11} />
                  <span>PostgreSQL</span>
                </div>
                <span className="text-emerald-400 font-medium">●  OK</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Radio size={11} />
                  <span>Kafka</span>
                </div>
                <span className="text-emerald-400 font-medium">●  OK</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <GitBranch size={11} />
                  <span>RabbitMQ</span>
                </div>
                <span className="text-emerald-400 font-medium">●  OK</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Shield size={11} />
                  <span>Redis</span>
                </div>
                <span className="text-emerald-400 font-medium">●  OK</span>
              </div>
            </div>
          )}

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full sidebar-link justify-center text-slate-500 hover:text-slate-300"
          >
            <ChevronRight
              size={16}
              className={`transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : ''}`}
            />
            {sidebarOpen && <span className="text-xs animate-fade-slide-in">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex-shrink-0 flex items-center justify-between px-6 py-4
                           border-b border-surface-border bg-surface-card/50 backdrop-blur-sm">
          <div>
            <h1 className="text-xl font-bold text-white">
              {NAV_ITEMS.find(n => n.id === activeView)?.label ?? 'Dashboard'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
              {' · '}
              {new Date().toLocaleTimeString('en-IN')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Simulate Event Button */}
            <button
              id="btn-simulate-event"
              onClick={handleSimulate}
              disabled={isSimulating}
              className="btn-primary"
            >
              <Bell size={15} className={isSimulating ? 'animate-bounce' : ''} />
              <span>{isSimulating ? 'Firing...' : 'Simulate Event'}</span>
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="animate-fade-slide-in" key={activeView}>
            {activeView === 'dashboard' && (
              <DashboardStats summary={summary} />
            )}
            {activeView === 'queue' && (
              <LiveQueueMonitor messages={queueMessages} isConnected={isConnected} />
            )}
            {activeView === 'preferences' && (
              <UserPreferencesForm />
            )}
            {activeView === 'analytics' && (
              <DashboardStats summary={summary} showAnalytics />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
