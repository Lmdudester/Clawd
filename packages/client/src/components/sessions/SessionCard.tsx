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
      className="w-full text-left p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-xl transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium text-white truncate">{session.name}</h3>
        <div className="flex items-center gap-2">
          <StatusBadge status={session.status} />
          <span
            role="button"
            onClick={handleClose}
            className="p-1.5 -mr-1.5 text-slate-400 active:text-red-400 transition-colors"
            aria-label="Close session"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-500 truncate mb-2">{session.cwd}</p>
      {session.lastMessagePreview && (
        <p className="text-sm text-slate-400 truncate">{session.lastMessagePreview}</p>
      )}
      <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
        <span>{new Date(session.createdAt).toLocaleString()}</span>
        {session.totalCostUsd > 0 && <span>${session.totalCostUsd.toFixed(4)}</span>}
      </div>
    </button>
  );
}
