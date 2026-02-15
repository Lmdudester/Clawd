import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import type { AuthStatusResponse } from '@clawd/shared';

export function AuthSettings() {
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [discoveredPaths, setDiscoveredPaths] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthStatus()
      .then(setStatus)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDiscover() {
    setDiscovering(true);
    setError(null);
    try {
      const res = await api.discoverCredentials();
      setDiscoveredPaths(res.paths);
      if (res.paths.length === 0) {
        setError('No credential files found. Make sure you are logged into the Claude CLI on your local machine.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSelect(path: string) {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.setAuthCredentials(path);
      setStatus(updated);
      setDiscoveredPaths(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.clearAuth();
      setStatus(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-slate-500 py-4">Loading auth status...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Authentication</h2>

      {/* Current status */}
      <div className="bg-slate-800 rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Method:</span>
          <StatusLabel method={status?.method ?? 'none'} />
        </div>

        {status?.maskedToken && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Token:</span>
            <code className="text-sm text-slate-300 bg-slate-700 px-2 py-0.5 rounded font-mono">
              {status.maskedToken}
            </code>
          </div>
        )}

        {status?.credentialsPath && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Path:</span>
            <code className="text-sm text-slate-300 bg-slate-700 px-2 py-0.5 rounded font-mono text-xs break-all">
              {status.credentialsPath}
            </code>
          </div>
        )}

      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {/* Discover button */}
        <button
          onClick={handleDiscover}
          disabled={discovering || saving}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {discovering ? 'Scanning...' : 'Discover Claude CLI Credentials'}
        </button>

        {/* Discovered paths */}
        {discoveredPaths && discoveredPaths.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-400">Found credential files:</p>
            {discoveredPaths.map((path) => (
              <button
                key={path}
                onClick={() => handleSelect(path)}
                disabled={saving}
                className="w-full text-left bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg p-3 transition-colors"
              >
                <code className="text-sm text-slate-300 font-mono break-all">{path}</code>
                <p className="text-xs text-blue-400 mt-1">Click to use these credentials</p>
              </button>
            ))}
          </div>
        )}

        {/* Clear button (only when OAuth is configured) */}
        {status?.method === 'oauth_credentials_file' && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 hover:text-white rounded-lg text-sm transition-colors"
          >
            Clear OAuth Credentials
          </button>
        )}
      </div>

      {/* Help text */}
      <div className="text-xs text-slate-500 space-y-1">
        <p>
          OAuth credentials connect to your Claude Max subscription via the Claude CLI.
        </p>
        <p>
          The server reads your local Claude CLI credentials file directly, so token refresh is automatic.
        </p>
      </div>
    </div>
  );
}

function StatusLabel({ method }: { method: AuthStatusResponse['method'] }) {
  switch (method) {
    case 'oauth_credentials_file':
      return <span className="text-sm font-medium text-green-400">OAuth Credentials File</span>;
    case 'none':
      return <span className="text-sm font-medium text-red-400">Not Configured</span>;
  }
}
