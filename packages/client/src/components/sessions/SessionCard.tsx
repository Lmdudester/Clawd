import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionInfo, ManagerStep } from '@clawd/shared';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useSessionStore } from '../../stores/sessionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { api } from '../../lib/api';
import { MODE_THEME } from '../../lib/mode-theme';

const MANAGER_STAGE: Record<ManagerStep, { label: string; text: string; bg: string; border: string }> = {
  idle:      { label: 'Manager',   text: 'text-purple-300',  bg: 'bg-purple-500/20',  border: 'border-purple-500/30' },
  exploring: { label: 'Exploring', text: 'text-blue-300',    bg: 'bg-blue-500/20',    border: 'border-blue-500/30' },
  triaging:  { label: 'Triaging',  text: 'text-violet-300',  bg: 'bg-violet-500/20',  border: 'border-violet-500/30' },
  planning:  { label: 'Planning',  text: 'text-indigo-300',  bg: 'bg-indigo-500/20',  border: 'border-indigo-500/30' },
  reviewing: { label: 'Reviewing', text: 'text-sky-300',     bg: 'bg-sky-500/20',     border: 'border-sky-500/30' },
  fixing:    { label: 'Fixing',    text: 'text-cyan-300',    bg: 'bg-cyan-500/20',    border: 'border-cyan-500/30' },
  testing:   { label: 'Testing',   text: 'text-green-300',   bg: 'bg-green-500/20',   border: 'border-green-500/30' },
  merging:   { label: 'Merging',   text: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' },
};

function repoShortName(url: string): string {
  // Extract just the repo name from a URL
  return url.split('/').filter(Boolean).pop()?.replace(/\.git$/, '') || url;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`([^`]*)`/g, '$1')        // inline code
    .replace(/\*\*(.+?)\*\*/g, '$1')    // bold **
    .replace(/__(.+?)__/g, '$1')        // bold __
    .replace(/\*(.+?)\*/g, '$1')        // italic *
    .replace(/_(.+?)_/g, '$1')          // italic _
    .replace(/~~(.+?)~~/g, '$1')        // strikethrough
    .replace(/^#{1,6}\s+/gm, '')        // headings
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/^\s*[-*+]\s+/gm, '')      // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')      // ordered list markers
    .replace(/^\s*>\s+/gm, '')          // blockquotes
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim();
}

export function SessionCard({ session }: { session: SessionInfo }) {
  const navigate = useNavigate();
  const removeSession = useSessionStore((s) => s.removeSession);
  const addSession = useSessionStore((s) => s.addSession);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    setConfirmOpen(false);
    removeSession(session.id);
    try {
      await api.deleteSession(session.id);
    } catch {
      addSession(session);
      addNotification('error', 'Failed to delete session');
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete session"
        message={`Delete session "${session.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
      <div
        role="link"
      tabIndex={0}
      onClick={() => navigate(`/session/${session.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/session/${session.id}`); } }}
      className="w-full text-left p-4 bg-blue-950/25 hover:bg-blue-950/40 border border-blue-900/25 rounded-xl transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-medium text-white truncate">
          {session.isManager && (() => {
            const stage = MANAGER_STAGE[session.managerState?.currentStep ?? 'idle'];
            return <span className={`inline-block text-xs font-semibold ${stage.text} ${stage.bg} border ${stage.border} px-1.5 py-0.5 rounded mr-2 align-middle`}>{stage.label}</span>;
          })()}
          {session.managedBy && (
            <span className="inline-block text-xs font-semibold text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded mr-2 align-middle">Managed</span>
          )}
          {session.name}
        </h3>
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
          {session.permissionMode === 'dangerous' && !session.isManager && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${MODE_THEME.dangerous.icon}`} aria-label="Dangerous mode">
              <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
            </svg>
          )}
          {session.notificationsEnabled && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-400" aria-label="Notifications enabled">
              <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z" clipRule="evenodd" />
            </svg>
          )}
          {session.isManager && session.managerState?.paused ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 border border-amber-500/50 rounded px-2 py-0.5">
              <span className={`w-2 h-2 rounded-full bg-amber-500 ${session.managerState.resumeAt ? 'animate-pulse' : ''}`} />
              {session.managerState.resumeAt ? 'Rate Limited' : 'Paused'}
            </span>
          ) : (
            <StatusBadge status={session.status} />
          )}
          <button
            onClick={handleClose}
            className="p-1 rounded border border-red-500/50 text-red-500 hover:text-red-400 hover:border-red-400/50 active:text-red-300 transition-colors bg-transparent"
            aria-label="Close session"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      </div>
      {session.lastMessagePreview && (
        <p className="text-base text-slate-400 truncate">{stripMarkdown(session.lastMessagePreview)}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-300 bg-blue-950/40 border border-blue-800/50 px-2 py-0.5 rounded">{repoShortName(session.repoUrl)}</span>
          <span className="text-sm text-slate-400 bg-slate-800/60 border border-slate-700/50 px-2 py-0.5 rounded font-mono">{session.branch}</span>
        </div>
        <span className="text-sm text-slate-300 bg-blue-950/40 border border-blue-800/50 px-2 py-0.5 rounded">{new Date(session.createdAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      </div>
    </>
  );
}
