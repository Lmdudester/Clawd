import { useState } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { parseChildEvents, type ChildEvent } from '../../lib/childEventParser';
import { getToolConfig } from '../../lib/toolFormatters';
import { MarkdownRenderer } from '../common/MarkdownRenderer';

const EVENT_STYLES = {
  approval_request: {
    borderClass: 'border-l-amber-500',
    bgClass: 'bg-amber-950/30',
    label: 'Approval Request',
    labelClass: 'text-amber-400',
    defaultExpanded: true,
  },
  session_ready: {
    borderClass: 'border-l-sky-500',
    bgClass: 'bg-sky-950/30',
    label: 'Session Ready',
    labelClass: 'text-sky-400',
    defaultExpanded: false,
  },
  session_completed: {
    borderClass: 'border-l-emerald-500',
    bgClass: 'bg-emerald-950/30',
    label: 'Session Completed',
    labelClass: 'text-emerald-400',
    defaultExpanded: true,
  },
  session_error: {
    borderClass: 'border-l-red-500',
    bgClass: 'bg-red-950/30',
    label: 'Session Error',
    labelClass: 'text-red-400',
    defaultExpanded: true,
  },
} as const;

function truncateId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) + '...' : id;
}

function SingleEventCard({ event }: { event: ChildEvent }) {
  const style = EVENT_STYLES[event.kind];
  const [expanded, setExpanded] = useState(style.defaultExpanded);

  return (
    <div
      className={`border-l-[3px] ${style.borderClass} ${style.bgClass} border border-slate-700/50 rounded-r-lg overflow-hidden`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left min-w-0"
      >
        <span className={`text-xs font-semibold ${style.labelClass} shrink-0`}>
          {style.label}
        </span>
        <span className="text-sm text-slate-200 truncate min-w-0">
          {event.sessionName}
        </span>
        <span className="text-xs text-slate-500 font-mono shrink-0">
          {truncateId(event.sessionId)}
        </span>
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

      {/* Body */}
      {expanded && (
        <div className="border-t border-slate-700/30 px-3 py-2">
          <EventBody event={event} />
        </div>
      )}
    </div>
  );
}

function EventBody({ event }: { event: ChildEvent }) {
  switch (event.kind) {
    case 'approval_request':
      return <ApprovalRequestBody event={event} />;
    case 'session_completed':
      return <SessionCompletedBody event={event} />;
    case 'session_ready':
    case 'session_error':
      return <SimpleBody text={event.body} />;
  }
}

function ApprovalRequestBody({
  event,
}: {
  event: Extract<ChildEvent, { kind: 'approval_request' }>;
}) {
  const toolConfig = getToolConfig(event.toolName);

  return (
    <div className="space-y-2">
      {/* Tool name badge */}
      <span
        className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded ${toolConfig.labelClass} bg-slate-800/60`}
      >
        {event.toolName}
      </span>

      {/* Tool input */}
      <pre className="text-sm font-mono text-slate-300 bg-slate-900/60 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
        <code>{event.toolInput}</code>
      </pre>

      {/* Reasoning */}
      {event.reasoning && (
        <div className="text-sm text-slate-300">
          <div className="text-xs text-slate-500 mb-1">Reasoning</div>
          <MarkdownRenderer content={event.reasoning} />
        </div>
      )}

      {/* Approval ID */}
      <div className="text-xs text-slate-500 font-mono">{event.approvalId}</div>
    </div>
  );
}

function SessionCompletedBody({
  event,
}: {
  event: Extract<ChildEvent, { kind: 'session_completed' }>;
}) {
  return (
    <div className="max-h-60 overflow-y-auto text-sm text-slate-200">
      <MarkdownRenderer content={event.childOutput} />
    </div>
  );
}

function SimpleBody({ text }: { text: string }) {
  return <p className="text-sm text-slate-300 whitespace-pre-wrap">{text}</p>;
}

// --- Main export ---

export function ChildEventCard({ message }: { message: SessionMessage }) {
  const events = parseChildEvents(message.content);

  // Fallback: render existing purple bubble
  if (!events) {
    return (
      <div className="flex justify-end mx-4 my-2">
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl text-base leading-relaxed bg-purple-600/20 border border-purple-500/30 text-purple-100 rounded-br-md">
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-1 space-y-1">
      {events.map((event, i) => (
        <SingleEventCard key={i} event={event} />
      ))}
    </div>
  );
}
