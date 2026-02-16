import { useNavigate } from 'react-router-dom';
import type { SessionInfo } from '@clawd/shared';
import { StatusBadge } from '../common/StatusBadge';
import { useSessionStore } from '../../stores/sessionStore';
import { api } from '../../lib/api';
import { MODE_THEME } from '../../lib/mode-theme';

function repoShortName(url: string): string {
  // Extract "user/repo" from a GitHub URL or just the last path segment
  const match = url.match(/(?:github\.com|gitlab\.com)[/:]([^/]+\/[^/.]+)/);
  if (match) return match[1];
  return url.split('/').filter(Boolean).pop()?.replace(/\.git$/, '') || url;
}

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
          {session.permissionMode === 'plan' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${MODE_THEME.plan.icon}`} aria-label="Plan mode">
              <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clipRule="evenodd" />
            </svg>
          )}
          {session.permissionMode === 'auto_edits' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${MODE_THEME.auto_edits.icon}`} aria-label="Auto-edits mode">
              <path d="M3.288 4.818A1.5 1.5 0 0 0 1 6.095v7.81a1.5 1.5 0 0 0 2.288 1.276l6.323-3.905c.155-.096.285-.213.389-.344v-2.864a1.505 1.505 0 0 0-.389-.344L3.288 4.818Z" />
              <path d="M11.288 4.818A1.5 1.5 0 0 0 9 6.095v7.81a1.5 1.5 0 0 0 2.288 1.276l6.323-3.905a1.5 1.5 0 0 0 0-2.552l-6.323-3.906Z" />
            </svg>
          )}
          {session.permissionMode === 'dangerous' && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${MODE_THEME.dangerous.icon}`} aria-label="Dangerous mode">
              <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
            </svg>
          )}
          {session.notificationsEnabled && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-400" aria-label="Notifications enabled">
              <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z" clipRule="evenodd" />
            </svg>
          )}
          <StatusBadge status={session.status} />
          <span
            role="button"
            onClick={handleClose}
            className="p-1 rounded border border-red-500/50 text-red-500 hover:text-red-400 hover:border-red-400/50 active:text-red-300 transition-colors"
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
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-300 bg-blue-950/40 border border-blue-800/50 px-2 py-0.5 rounded">{repoShortName(session.repoUrl)}</span>
          <span className="text-sm text-slate-400 bg-slate-800/60 border border-slate-700/50 px-2 py-0.5 rounded font-mono">{session.branch}</span>
        </div>
        <span className="text-sm text-slate-300 bg-blue-950/40 border border-blue-800/50 px-2 py-0.5 rounded">{new Date(session.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    </button>
  );
}
