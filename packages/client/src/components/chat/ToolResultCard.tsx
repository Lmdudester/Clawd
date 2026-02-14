import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';

export function ToolResultCard({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);
  const preview = message.content.slice(0, 80) + (message.content.length > 80 ? '...' : '');

  return (
    <div className="mx-4 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-400 transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="text-slate-500">result</span>
        {!expanded && <span className="truncate max-w-[250px]">{preview}</span>}
      </button>
      {expanded && (
        <pre className="mt-1 p-2 bg-slate-900/50 border border-slate-700/30 rounded-lg text-xs text-slate-400 overflow-x-auto max-h-60 overflow-y-auto">
          {message.content}
        </pre>
      )}
    </div>
  );
}
