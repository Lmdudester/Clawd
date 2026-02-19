import { useRef, useEffect, useState, useMemo } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { PlanCard } from './PlanCard';
import { StreamingText } from './StreamingText';
import { groupMessages } from '../../lib/messageGrouping';

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
