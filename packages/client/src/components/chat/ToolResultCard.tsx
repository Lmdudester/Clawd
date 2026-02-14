import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';

export function ToolResultCard({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);
  const preview = message.content.slice(0, 80) + (message.content.length > 80 ? '...' : '');

  return (
    <div className="mx-4 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/40 border border-slate-700/30 rounded-md text-[11px] text-slate-500 hover:text-slate-400 hover:bg-slate-800/60 transition-colors w-fit max-w-full"
      >
        <span className={`transition-transform text-[10px] ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="font-mono text-slate-400">result</span>
        {!expanded && <span className="truncate text-slate-500/70">{preview}</span>}
      </button>
      {expanded && (
        <pre className="mt-1 ml-3 p-2 bg-slate-900/50 border border-slate-700/30 rounded-md text-[11px] text-slate-400 overflow-x-auto max-h-60 overflow-y-auto">
          {message.content}
        </pre>
      )}
    </div>
  );
}
