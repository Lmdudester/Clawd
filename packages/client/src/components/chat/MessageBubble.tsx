import type { SessionMessage } from '@clawd/shared';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';

export function MessageBubble({ message }: { message: SessionMessage }) {
  // Fallback — tool messages are normally rendered through ToolGroup
  if (message.type === 'tool_call') {
    return <ToolCallCard message={message} />;
  }
  if (message.type === 'tool_result') {
    return <ToolResultCard message={message} />;
  }

  if (message.type === 'error') {
    return (
      <div className="mx-4 my-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
        {message.content}
      </div>
    );
  }

  if (message.type === 'system') {
    return (
      <div className="mx-4 my-2 px-4 py-2.5 bg-slate-800/50 border border-slate-700/40 rounded-lg text-sm text-slate-300">
        <MarkdownRenderer content={message.content} />
      </div>
    );
  }

  const isUser = message.type === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mx-4 my-2`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-base leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-slate-800 text-slate-100 rounded-bl-md border border-slate-700/50'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>
    </div>
  );
}
