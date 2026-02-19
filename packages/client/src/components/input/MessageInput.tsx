import { useState, useRef, useEffect } from 'react';

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  isInterruptible?: boolean;
  onInterrupt?: () => void;
}

export function MessageInput({ onSend, disabled, isInterruptible, onInterrupt }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isInterruptible) {
      e.preventDefault();
      onInterrupt?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Global Escape handler so it works even when textarea isn't focused
  useEffect(() => {
    if (!isInterruptible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onInterrupt?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isInterruptible, onInterrupt]);

  const handleInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  return (
    <div className="flex items-end gap-2 p-3 pb-5 bg-slate-900 border-t border-slate-800">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="Message Claude..."
        disabled={disabled}
        rows={1}
        className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none text-base"
        data-testid="message-input"
      />
      {isInterruptible && (
        <button
          onClick={onInterrupt}
          className="px-4 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl font-medium transition-colors shrink-0 flex items-center gap-1.5"
          title="Stop generation (Esc)"
          data-testid="stop-button"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
            <rect x="3" y="3" width="10" height="10" rx="1" />
          </svg>
          Stop
        </button>
      )}
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors shrink-0"
        data-testid="send-button"
      >
        Send
      </button>
    </div>
  );
}
