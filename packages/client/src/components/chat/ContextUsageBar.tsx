import { useState } from 'react';
import type { ContextUsage } from '@clawd/shared';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function barColor(pct: number): string {
  if (pct > 85) return 'bg-red-500';
  if (pct > 60) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

export function ContextUsageBar({ usage }: { usage: ContextUsage }) {
  const [expanded, setExpanded] = useState(false);

  const totalInput = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
  const contextPct = usage.contextWindow > 0
    ? (totalInput / usage.contextWindow) * 100
    : 0;

  return (
    <div className="px-4 py-1.5 bg-slate-900/60 border-b border-slate-800 shrink-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 text-xs text-slate-400"
      >
        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor(contextPct)}`}
            style={{ width: `${Math.min(contextPct, 100)}%` }}
          />
        </div>
        <span className="shrink-0">
          {contextPct.toFixed(0)}% context
        </span>
        <span className="shrink-0 text-slate-500">|</span>
        <span className="shrink-0">{formatCost(usage.totalCostUsd)}</span>
        <span className="shrink-0 text-slate-500">|</span>
        <span className="shrink-0">{usage.numTurns} turns</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-4 h-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 pb-1">
          <div className="flex justify-between">
            <span>Input tokens</span>
            <span className="text-slate-300">{formatTokens(usage.inputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Output tokens</span>
            <span className="text-slate-300">{formatTokens(usage.outputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cache read</span>
            <span className="text-slate-300">{formatTokens(usage.cacheReadInputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cache creation</span>
            <span className="text-slate-300">{formatTokens(usage.cacheCreationInputTokens)}</span>
          </div>
          <div className="flex justify-between">
            <span>Context window</span>
            <span className="text-slate-300">{formatTokens(usage.contextWindow)}</span>
          </div>
          <div className="flex justify-between">
            <span>API time</span>
            <span className="text-slate-300">{formatDuration(usage.durationApiMs)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
