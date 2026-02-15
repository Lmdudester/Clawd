import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';

export function ToolResultCard({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);
  const preview = message.content.slice(0, 80) + (message.content.length > 80 ? '...' : '');

  return (
    <div className="mx-4 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/40 border border-slate-600 rounded-md text-sm text-white hover:text-white hover:bg-slate-900/50 transition-colors w-fit max-w-full"
      >
        <span className={`transition-transform text-lg ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="font-mono text-white">result</span>
        {!expanded && <span className="truncate text-slate-100">{preview}</span>}
      </button>
      {expanded && (
        <pre className="mt-1 ml-3 p-2 bg-slate-900/50 border border-slate-600 rounded-md text-sm text-white overflow-x-auto max-h-60 overflow-y-auto">
          {message.content}
        </pre>
      )}
    </div>
  );
}
