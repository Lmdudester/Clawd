import { useState } from 'react';

export function CodeBlock({ children, language }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden bg-slate-900 border border-slate-700/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/50 text-xs text-slate-400">
        <span>{language || 'code'}</span>
        <button
          onClick={copy}
          className="hover:text-white transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-sm">
        <code>{children}</code>
      </pre>
    </div>
  );
}
