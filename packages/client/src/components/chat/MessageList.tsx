import { useRef, useEffect, useState } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { MessageBubble } from './MessageBubble';
import { StreamingText } from './StreamingText';

interface Props {
  messages: SessionMessage[];
  streamingText: string;
}

export function MessageList({ messages, streamingText }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

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
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
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
