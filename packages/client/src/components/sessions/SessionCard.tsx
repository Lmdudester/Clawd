import { useNavigate } from 'react-router-dom';
import type { SessionInfo } from '@clawd/shared';
import { StatusBadge } from '../common/StatusBadge';
import { useSessionStore } from '../../stores/sessionStore';
import { api } from '../../lib/api';

export function SessionCard({ session }: { session: SessionInfo }) {
  const navigate = useNavigate();
  const removeSession = useSessionStore((s) => s.removeSession);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    api.deleteSession(session.id).then(() => removeSession(session.id)).catch(() => {});
  };

  return (
    <button
      onClick={() => navigate(`/session/${session.id}`)}
      className="w-full text-left p-4 bg-blue-950/25 hover:bg-blue-950/40 border border-blue-900/25 rounded-xl transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-medium text-white truncate">{session.name}</h3>
        <div className="flex items-center gap-2">
          <StatusBadge status={session.status} />
          <span
            role="button"
            onClick={handleClose}
            className="p-1 rounded border border-red-900/50 text-red-900 hover:text-red-700 hover:border-red-700/50 active:text-red-500 transition-colors"
            aria-label="Close session"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </span>
        </div>
      </div>
      {session.lastMessagePreview && (
        <p className="text-base text-slate-400 truncate">{session.lastMessagePreview}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm text-slate-500 bg-blue-950/40 px-2 py-0.5 rounded">{session.cwd.split(/[/\\]/).filter(Boolean).pop()}</span>
        <span className="text-sm text-slate-500 bg-blue-950/40 px-2 py-0.5 rounded">{new Date(session.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    </button>
  );
}
