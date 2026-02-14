import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';

export function ToolCallCard({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);

  const summary = message.toolInput
    ? message.toolName === 'Bash'
      ? (message.toolInput as any).command
      : message.toolName === 'Read' || message.toolName === 'Edit'
      ? (message.toolInput as any).file_path
      : ''
    : '';

  return (
    <div className="mx-4 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/40 border border-slate-700/30 rounded-md text-[11px] text-slate-500 hover:text-slate-400 hover:bg-slate-800/60 transition-colors w-fit max-w-full"
      >
        <span className={`transition-transform text-[10px] ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="font-mono text-slate-400">{message.toolName}</span>
        {!expanded && summary && (
          <span className="truncate text-slate-500/70">{summary}</span>
        )}
      </button>
      {expanded && (
        <pre className="mt-1 ml-3 p-2 bg-slate-900/50 border border-slate-700/30 rounded-md text-[11px] text-slate-400 overflow-x-auto">
          {message.content}
        </pre>
      )}
    </div>
  );
}
