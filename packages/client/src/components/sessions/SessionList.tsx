import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';
import { SessionCard } from './SessionCard';
import { NewSessionDialog } from './NewSessionDialog';

export function SessionList() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    api.getSessions()
      .then((res) => setSessions(res.sessions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setSessions]);

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/clawd.png" alt="Clawd" className="w-7 h-7 rounded" />
            <h1 className="text-xl font-bold text-white">Clawd</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/settings')}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.982.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
            </button>
            <button onClick={logout} className="text-sm text-slate-400 hover:text-white transition-colors">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Session list */}
      <main className="p-4 space-y-3 pb-24">
        {loading ? (
          <div className="text-center text-slate-500 py-12">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            <p className="text-lg mb-1">No sessions yet</p>
            <p className="text-sm">Create one to get started</p>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))
        )}
      </main>

      {/* FAB */}
      <button
        onClick={() => setDialogOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center text-2xl transition-colors"
      >
        +
      </button>

      <NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
