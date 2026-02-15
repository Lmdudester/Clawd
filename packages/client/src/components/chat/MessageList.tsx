import { useRef, useEffect, useState, useMemo } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { PlanCard } from './PlanCard';
import { StreamingText } from './StreamingText';

type Segment =
  | { kind: 'message'; message: SessionMessage }
  | { kind: 'tool_group'; messages: SessionMessage[] }
  | { kind: 'plan_write'; toolCall: SessionMessage; result?: SessionMessage; fullContent: string };

function isPlanFileWrite(msg: SessionMessage): boolean {
  if (msg.type !== 'tool_call') return false;
  if (msg.toolName !== 'Write' && msg.toolName !== 'Edit') return false;
  const filePath = String((msg.toolInput as Record<string, unknown>)?.file_path ?? '');
  return filePath.includes('.claude/plans/') || filePath.includes('.claude\\plans\\');
}

function groupMessages(messages: SessionMessage[]): Segment[] {
  const segments: Segment[] = [];
  // Track accumulated plan content per file path for Edit support
  const planContent = new Map<string, string>();
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.type === 'tool_call' || msg.type === 'tool_result') {
      // Collect the full consecutive tool_call/tool_result sequence
      const group: SessionMessage[] = [];
      while (i < messages.length && (messages[i].type === 'tool_call' || messages[i].type === 'tool_result')) {
        group.push(messages[i]);
        i++;
      }

      // Split into plan_write segments and remaining tool_group segments
      const nonPlan: SessionMessage[] = [];
      for (let j = 0; j < group.length; j++) {
        const m = group[j];
        if (isPlanFileWrite(m)) {
          // Flush any accumulated non-plan messages as a tool_group
          if (nonPlan.length > 0) {
            segments.push({ kind: 'tool_group', messages: [...nonPlan] });
            nonPlan.length = 0;
          }
          // Check if the next message is the corresponding tool_result
          let result: SessionMessage | undefined;
          if (j + 1 < group.length && group[j + 1].type === 'tool_result') {
            result = group[j + 1];
            j++; // skip the result in the loop
          }

          // Build full plan content by applying writes/edits
          const input = m.toolInput as Record<string, unknown> | undefined;
          const filePath = String(input?.file_path ?? '');
          let fullContent: string;
          if (m.toolName === 'Write') {
            fullContent = String(input?.content ?? '');
          } else {
            // Edit: apply replacement on accumulated content
            const prev = planContent.get(filePath) ?? '';
            const oldStr = String(input?.old_string ?? '');
            const newStr = String(input?.new_string ?? '');
            fullContent = oldStr ? prev.replace(oldStr, newStr) : prev;
          }
          planContent.set(filePath, fullContent);

          segments.push({ kind: 'plan_write', toolCall: m, result, fullContent });
        } else {
          nonPlan.push(m);
        }
      }
      // Flush remaining non-plan messages
      if (nonPlan.length > 0) {
        segments.push({ kind: 'tool_group', messages: nonPlan });
      }
    } else {
      segments.push({ kind: 'message', message: msg });
      i++;
    }
  }
  return segments;
}

interface Props {
  messages: SessionMessage[];
  streamingText: string;
}

export function MessageList({ messages, streamingText }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const segments = useMemo(() => groupMessages(messages), [messages]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setAutoScroll(nearBottom);
    setShowScrollButton(!nearBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto py-4"
    >
      {messages.length === 0 && !streamingText && (
        <div className="text-center text-slate-500 py-12">
          <p className="text-lg">Send a message to get started</p>
        </div>
      )}
      {segments.map((seg, idx) => {
        if (seg.kind === 'plan_write') {
          const isLatest = !segments.slice(idx + 1).some((s) => s.kind === 'plan_write');
          return (
            <PlanCard
              key={seg.toolCall.id}
              toolCall={seg.toolCall}
              result={seg.result}
              fullContent={seg.fullContent}
              defaultCollapsed={!isLatest}
            />
          );
        }
        if (seg.kind === 'tool_group') {
          return (
            <ToolGroup key={seg.messages[0].id} messages={seg.messages} />
          );
        }
        return (
          <MessageBubble key={seg.message.id} message={seg.message} />
        );
      })}
      {streamingText && <StreamingText text={streamingText} />}
      <div ref={bottomRef} />

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-4 w-10 h-10 bg-slate-700 hover:bg-slate-600 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
        >
          &#8595;
        </button>
      )}
    </div>
  );
}
