import type { PendingApproval } from '@clawd/shared';

interface Props {
  approval: PendingApproval;
  onApprove: (approvalId: string, allow: boolean) => void;
  onInterrupt?: () => void;
}

export function ApprovalBanner({ approval, onApprove, onInterrupt }: Props) {
  const toolName = approval.toolName;
  const preview =
    toolName === 'Bash'
      ? (approval.toolInput as any).command
      : toolName === 'Edit' || toolName === 'Read' || toolName === 'Write'
      ? (approval.toolInput as any).file_path
      : JSON.stringify(approval.toolInput).slice(0, 100);

  return (
    <div className="border-t border-amber-500/30">
      <div className="p-3 bg-amber-500/10">
        <p className="text-sm font-medium text-amber-300">
          {toolName === 'ExitPlanMode' ? 'Approve plan as-is?' : <>Allow <span className="font-mono">{toolName}</span>?</>}
        </p>
        {toolName !== 'ExitPlanMode' && <p className="text-xs text-slate-400 truncate mt-0.5">{preview}</p>}
      </div>
      <div className="flex">
        <button
          onClick={() => onApprove(approval.id, false)}
          className="flex-1 py-4 text-lg font-bold bg-red-600 hover:bg-red-500 active:bg-red-700 text-white transition-colors"
        >
          No
        </button>
        <button
          onClick={() => onApprove(approval.id, true)}
          className="flex-1 py-4 text-lg font-bold bg-green-600 hover:bg-green-500 active:bg-green-700 text-white transition-colors"
        >
          Yes
        </button>
      </div>
      {onInterrupt && (
        <button
          onClick={onInterrupt}
          className="w-full py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-colors"
        >
          Stop entire turn
        </button>
      )}
    </div>
  );
}
