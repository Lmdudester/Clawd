import { useState, useEffect, useRef } from 'react';
import type { SkillInfo } from '@clawd/shared';

interface Props {
  skills: SkillInfo[];
  filter: string;
  onSelect: (skill: SkillInfo) => void;
  onClose: () => void;
}

export function SkillPicker({ skills, filter, onSelect, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = skills.filter((s) =>
    s.name.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        onSelect(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selectedIndex, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg z-10"
      data-testid="skill-picker"
    >
      {filtered.map((skill, i) => (
        <button
          key={skill.name}
          onClick={() => onSelect(skill)}
          className={`w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors ${
            i === selectedIndex ? 'bg-blue-600/30' : 'hover:bg-slate-700'
          }`}
          data-testid={`skill-option-${skill.name}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-yellow-400 shrink-0">
            <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
          </svg>
          <div>
            <span className="text-white text-sm font-medium">/{skill.name}</span>
            {skill.description && (
              <span className="text-slate-400 text-xs ml-2">{skill.description}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
