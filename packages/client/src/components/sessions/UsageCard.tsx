import { useUsage } from '../../hooks/useUsage';
import type { RateLimitBucket, UnifiedBucket } from '@clawd/shared';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatRelativeTime(epochOrIso: string | number): string {
  const target = typeof epochOrIso === 'number'
    ? epochOrIso * 1000
    : new Date(epochOrIso).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

function barColor(pctUsed: number): string {
  if (pctUsed > 85) return 'bg-red-500';
  if (pctUsed > 60) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function StandardBar({ label, bucket }: { label: string; bucket: RateLimitBucket }) {
  const used = bucket.limit - bucket.remaining;
  const pctUsed = bucket.limit > 0 ? (used / bucket.limit) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">
          {formatNumber(used)} / {formatNumber(bucket.limit)}
          <span className="ml-2 text-slate-500">({formatRelativeTime(bucket.reset)})</span>
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(pctUsed)}`}
          style={{ width: `${Math.min(pctUsed, 100)}%` }}
        />
      </div>
    </div>
  );
}

function UnifiedBar({ label, bucket }: { label: string; bucket: UnifiedBucket }) {
  const pctUsed = bucket.utilization * 100;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">
          {pctUsed.toFixed(0)}% used
          <span className="ml-2 text-slate-500">({formatRelativeTime(bucket.reset)})</span>
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(pctUsed)}`}
          style={{ width: `${Math.min(pctUsed, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function UsageCard() {
  const { usage, loading, error, refresh } = useUsage();

  if (!loading && usage?.authMethod === 'none') return null;

  if (error) {
    return (
      <div className="p-4 bg-slate-900/80 border border-red-800/50 rounded-xl">
        <div className="flex items-center justify-between">
          <div className="text-sm text-red-400">{error}</div>
          <button
            onClick={refresh}
            disabled={loading}
            className="ml-3 px-3 py-1 text-xs rounded border border-red-500/50 text-red-400 hover:text-red-300 hover:border-red-300/50 transition-colors disabled:opacity-50 shrink-0"
          >
            {loading ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const hasUnified = usage?.unified5h || usage?.unified7d;
  const hasStandard = usage?.tokens || usage?.inputTokens || usage?.outputTokens || usage?.requests;

  if (!loading && usage && !hasUnified && !hasStandard) return null;

  return (
    <div className="p-4 bg-slate-900/80 border border-slate-800/50 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-medium text-slate-200">API Usage</h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded border border-blue-500/50 text-blue-400 hover:text-blue-300 hover:border-blue-300/50 transition-colors disabled:opacity-50"
          aria-label="Refresh usage"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`}
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.451a.75.75 0 0 0 0-1.5H4.5a.75.75 0 0 0-.75.75v3.75a.75.75 0 0 0 1.5 0v-2.033l.364.363a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39l-.065.043Zm-10.624-2.85a5.5 5.5 0 0 1 9.201-2.465l.312.31H12.75a.75.75 0 0 0 0 1.5h3.75a.75.75 0 0 0 .75-.75V3.42a.75.75 0 0 0-1.5 0v2.033l-.364-.364A7 7 0 0 0 3.674 8.227a.75.75 0 0 0 1.449.39l.065-.043Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {loading && !usage ? (
        <div className="text-sm text-slate-400">Loading usage...</div>
      ) : (
        <div className="space-y-2.5">
          {usage?.unified5h && <UnifiedBar label="5-hour window" bucket={usage.unified5h} />}
          {usage?.unified7d && <UnifiedBar label="7-day window" bucket={usage.unified7d} />}
          {usage?.tokens && <StandardBar label="Tokens" bucket={usage.tokens} />}
          {usage?.inputTokens && <StandardBar label="Input tokens" bucket={usage.inputTokens} />}
          {usage?.outputTokens && <StandardBar label="Output tokens" bucket={usage.outputTokens} />}
          {usage?.requests && <StandardBar label="Requests" bucket={usage.requests} />}
        </div>
      )}
    </div>
  );
}
