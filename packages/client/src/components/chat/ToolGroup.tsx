import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: SessionMessage[];
}

export function ToolGroup({ messages }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toolCalls = messages.filter((m) => m.type === 'tool_call');
  const callCount = toolCalls.length;
  const uniqueTools = [...new Set(toolCalls.map((m) => m.toolName).filter(Boolean))];

  return (
    <div className="mx-4 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/40 border border-slate-700/30 rounded-md text-[11px] text-slate-500 hover:text-slate-400 hover:bg-slate-800/60 transition-colors w-fit max-w-full"
      >
        <span className={`transition-transform text-[10px] ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="text-slate-400">
          {callCount} tool call{callCount !== 1 ? 's' : ''}
        </span>
        {!expanded && uniqueTools.length > 0 && (
          <span className="font-mono text-slate-500/70">{uniqueTools.join(', ')}</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 ml-1 pl-2 border-l border-slate-700/30">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
