import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { isErrorResult } from '../../lib/toolFormatters';

/**
 * Standalone fallback for orphaned tool_result messages that aren't paired with a tool_call.
 * The primary rendering path is inline inside ToolCallCard.
 */
export function ToolResultCard({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = isErrorResult(message.content);
  const preview =
    message.content.slice(0, 120).replace(/\n/g, ' ') +
    (message.content.length > 120 ? '...' : '');

  return (
    <div className="mx-4 my-1">
      <div
        className={`border-l-[3px] ${hasError ? 'border-l-red-500 bg-red-950/20' : 'border-l-slate-500 bg-slate-900/30'} border border-slate-700/50 rounded-r-lg overflow-hidden`}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left min-w-0"
        >
          <span
            className={`text-xs font-semibold shrink-0 ${hasError ? 'text-red-400' : 'text-emerald-400'}`}
          >
            {hasError ? 'Error' : 'Result'}
          </span>
          {!expanded && (
            <span className="text-sm text-slate-300 truncate min-w-0">{preview}</span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ml-auto ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="border-t border-slate-700/30 px-3 py-2">
            <pre className="text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
              {message.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
