import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';
import { SessionCard } from './SessionCard';
import { NewSessionDialog } from './NewSessionDialog';
import { UsageCard } from './UsageCard';
import type { SessionInfo, SessionStatus } from '@clawd/shared';

type SessionTypeFilter = 'all' | 'regular' | 'manager' | 'managed';

const TYPE_FILTERS: { value: SessionTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'regular', label: 'Regular' },
  { value: 'manager', label: 'Manager' },
  { value: 'managed', label: 'Managed' },
];

const STATUS_FILTERS: { value: SessionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'running', label: 'Running' },
  { value: 'idle', label: 'Idle' },
  { value: 'starting', label: 'Starting' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'awaiting_answer', label: 'Awaiting answer' },
  { value: 'error', label: 'Error' },
  { value: 'terminated', label: 'Terminated' },
];

function matchesType(session: SessionInfo, filter: SessionTypeFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'regular': return !session.isManager && !session.managedBy;
    case 'manager': return !!session.isManager;
    case 'managed': return !!session.managedBy;
  }
}

function matchesSearch(session: SessionInfo, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    session.name.toLowerCase().includes(q) ||
    session.repoUrl.toLowerCase().includes(q) ||
    session.branch.toLowerCase().includes(q)
  );
}

export function SessionList() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const logout = useAuthStore((s) => s.logout);

  const [typeFilter, setTypeFilter] = useState<SessionTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    api.getSessions()
      .then((res) => setSessions(res.sessions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setSessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) =>
      matchesType(s, typeFilter) &&
      (statusFilter === 'all' || s.status === statusFilter) &&
      matchesSearch(s, searchQuery)
    );
  }, [sessions, typeFilter, statusFilter, searchQuery]);

  const hasFilters = typeFilter !== 'all' || statusFilter !== 'all' || searchQuery !== '';

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => window.location.reload()} className="flex items-center gap-2 cursor-pointer">
            <img src="/clawd.png" alt="Clawd" className="w-7 h-7 rounded" />
            <h1 className="text-xl font-bold text-white">Clawd</h1>
          </button>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/settings')}
              className="text-slate-200 hover:text-white transition-colors border border-slate-500 rounded w-8 h-8 flex items-center justify-center"
              aria-label="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.982.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
            </button>
            <button onClick={logout} className="text-sm text-slate-200 hover:text-white border border-slate-500 rounded px-2 py-0.5 transition-colors">
              Logout
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {!loading && sessions.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
            {/* Type filter chips */}
            <div className="flex items-center gap-1">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    typeFilter === f.value
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SessionStatus | 'all')}
              className="text-xs bg-slate-800/60 border border-slate-700 text-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            {/* Search */}
            <div className="flex-1 min-w-[120px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full text-xs bg-slate-800/60 border border-slate-700 text-slate-300 rounded px-2.5 py-1 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setSearchQuery(''); }}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </header>

      {/* Session list */}
      <main className="p-4 space-y-3 pb-24">
        <UsageCard />
        {loading ? (
          <div className="text-center text-slate-500 py-12">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            <p className="text-lg mb-1">No sessions yet</p>
            <p className="text-sm">Create one to get started</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            <p className="text-sm">No sessions match the current filters</p>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))
        )}
      </main>

      {/* FAB */}
      <button
        onClick={() => setDialogOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center text-2xl transition-colors"
        data-testid="new-session-button"
      >
        +
      </button>

      <NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
