import type { SessionStatus } from '@clawd/shared';

const statusConfig: Record<SessionStatus, { dot: string; border: string; text: string; label: string }> = {
  starting: { dot: 'bg-blue-500', border: 'border-blue-500/50', text: 'text-blue-400', label: 'Starting' },
  idle: { dot: 'bg-slate-400', border: 'border-slate-400/50', text: 'text-slate-300', label: 'Idle' },
  running: { dot: 'bg-green-500', border: 'border-green-500/50', text: 'text-green-400', label: 'Running' },
  awaiting_approval: { dot: 'bg-amber-500', border: 'border-amber-500/50', text: 'text-amber-400', label: 'Approval' },
  awaiting_answer: { dot: 'bg-purple-500', border: 'border-purple-500/50', text: 'text-purple-400', label: 'Question' },
  reconnecting: { dot: 'bg-blue-500', border: 'border-blue-500/50', text: 'text-blue-400', label: 'Reconnecting' },
  error: { dot: 'bg-red-500', border: 'border-red-500/50', text: 'text-red-400', label: 'Error' },
  terminated: { dot: 'bg-slate-600', border: 'border-slate-600/50', text: 'text-slate-500', label: 'Ended' },
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${config.text} border ${config.border} rounded px-2 py-0.5`}>
      <span className={`w-2 h-2 rounded-full ${config.dot} ${status === 'running' || status === 'starting' || status === 'reconnecting' ? 'animate-pulse' : ''}`} />
      {config.label}
    </span>
  );
}
