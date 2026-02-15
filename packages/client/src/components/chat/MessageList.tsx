import { useRef, useEffect, useState, useMemo } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { MessageBubble } from './MessageBubble';
import { ToolGroup } from './ToolGroup';
import { StreamingText } from './StreamingText';

type Segment =
  | { kind: 'message'; message: SessionMessage }
  | { kind: 'tool_group'; messages: SessionMessage[] };

function groupMessages(messages: SessionMessage[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.type === 'tool_call' || msg.type === 'tool_result') {
      const group: SessionMessage[] = [msg];
      i++;
      while (i < messages.length && (messages[i].type === 'tool_call' || messages[i].type === 'tool_result')) {
        group.push(messages[i]);
        i++;
      }
      segments.push({ kind: 'tool_group', messages: group });
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
      {segments.map((seg) =>
        seg.kind === 'tool_group' ? (
          <ToolGroup key={seg.messages[0].id} messages={seg.messages} />
        ) : (
          <MessageBubble key={seg.message.id} message={seg.message} />
        )
      )}
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
