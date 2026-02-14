import type { SessionStatus } from '@clawd/shared';

const statusConfig: Record<SessionStatus, { color: string; label: string }> = {
  idle: { color: 'bg-slate-500', label: 'Idle' },
  running: { color: 'bg-green-500', label: 'Running' },
  awaiting_approval: { color: 'bg-amber-500', label: 'Approval' },
  awaiting_answer: { color: 'bg-purple-500', label: 'Question' },
  error: { color: 'bg-red-500', label: 'Error' },
  terminated: { color: 'bg-slate-600', label: 'Ended' },
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
      <span className={`w-2 h-2 rounded-full ${config.color} ${status === 'running' ? 'animate-pulse' : ''}`} />
      {config.label}
    </span>
  );
}
