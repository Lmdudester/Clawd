import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';

export function ToolCallCard({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mx-4 my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="font-mono text-amber-400/80">{message.toolName}</span>
        {!expanded && message.toolInput && (
          <span className="text-slate-500 truncate max-w-[200px]">
            {message.toolName === 'Bash'
              ? (message.toolInput as any).command
              : message.toolName === 'Read'
              ? (message.toolInput as any).file_path
              : message.toolName === 'Edit'
              ? (message.toolInput as any).file_path
              : ''}
          </span>
        )}
      </button>
      {expanded && (
        <pre className="mt-1 p-2 bg-slate-900 border border-slate-700/50 rounded-lg text-xs text-slate-300 overflow-x-auto">
          {message.content}
        </pre>
      )}
    </div>
  );
}
