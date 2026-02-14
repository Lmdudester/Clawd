import { useState } from 'react';
import type { PendingQuestion } from '@clawd/shared';

interface Props {
  question: PendingQuestion;
  onAnswer: (questionId: string, answers: Record<string, string>) => void;
}

export function QuestionPanel({ question, onAnswer }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  const handleSelect = (questionText: string, label: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      if (multiSelect) {
        const current = prev[questionText]?.split(', ').filter(Boolean) ?? [];
        const updated = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [questionText]: updated.join(', ') };
      }
      return { ...prev, [questionText]: label };
    });
  };

  const handleSubmit = () => {
    // Merge custom inputs
    const merged = { ...answers };
    for (const [key, value] of Object.entries(customInputs)) {
      if (value.trim()) merged[key] = value.trim();
    }
    onAnswer(question.id, merged);
  };

  return (
    <div className="p-3 bg-purple-500/10 border-t border-purple-500/30 space-y-3 max-h-[60vh] overflow-y-auto">
      {question.questions.map((q, qi) => (
        <div key={qi}>
          <p className="text-sm font-medium text-purple-300 mb-2">{q.question}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => {
              const selected = q.multiSelect
                ? answers[q.question]?.split(', ').includes(opt.label)
                : answers[q.question] === opt.label;
              return (
                <button
                  key={opt.label}
                  onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selected
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            placeholder="Or type a custom answer..."
            value={customInputs[q.question] ?? ''}
            onChange={(e) => setCustomInputs((prev) => ({ ...prev, [q.question]: e.target.value }))}
            className="mt-2 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>
      ))}
      <button
        onClick={handleSubmit}
        className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
      >
        Submit Answer
      </button>
    </div>
  );
}
