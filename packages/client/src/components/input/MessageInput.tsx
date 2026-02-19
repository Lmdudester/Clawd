import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { SkillPicker } from './SkillPicker';
import type { SkillInfo } from '@clawd/shared';

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  isInterruptible?: boolean;
  onInterrupt?: () => void;
}

export function MessageInput({ onSend, disabled, isInterruptible, onInterrupt }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const skillsFetchedRef = useRef(false);

  // Fetch skills once on mount
  useEffect(() => {
    if (skillsFetchedRef.current) return;
    skillsFetchedRef.current = true;
    api.getSkills().then((res) => setSkills(res.skills)).catch(() => {});
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    setShowSkillPicker(false);
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Let the SkillPicker handle arrow keys and Enter when open
    if (showSkillPicker && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      return; // SkillPicker's global handler will process these
    }
    if (e.key === 'Escape') {
      if (showSkillPicker) {
        e.preventDefault();
        setShowSkillPicker(false);
        return;
      }
      if (isInterruptible) {
        e.preventDefault();
        onInterrupt?.();
        return;
      }
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Show skill picker when the input starts with '/' and has no spaces yet
    if (newValue.startsWith('/') && !newValue.includes(' ') && skills.length > 0) {
      setShowSkillPicker(true);
    } else {
      setShowSkillPicker(false);
    }
  };

  const handleSkillSelect = useCallback((skill: SkillInfo) => {
    const message = `/${skill.name}`;
    setValue(message);
    setShowSkillPicker(false);
    // Auto-send the skill command
    onSend(message);
    setValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [onSend]);

  const handleSkillClose = useCallback(() => {
    setShowSkillPicker(false);
  }, []);

  // Extract filter text (everything after '/')
  const skillFilter = value.startsWith('/') ? value.slice(1) : '';

  return (
    <div className="relative flex items-end gap-2 p-3 pb-5 bg-slate-900 border-t border-slate-800">
      {showSkillPicker && (
        <SkillPicker
          skills={skills}
          filter={skillFilter}
          onSelect={handleSkillSelect}
          onClose={handleSkillClose}
        />
      )}
      <textarea
        ref={inputRef}
        value={value}
        onChange={handleChange}
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
