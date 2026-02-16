import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import type { ProjectRepo } from '@clawd/shared';

export function ProjectFolderSettings() {
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newBranch, setNewBranch] = useState('main');

  useEffect(() => {
    api.getProjectRepos()
      .then((res) => setRepos(res.repos))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function saveRepos(updated: ProjectRepo[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await api.setProjectRepos(updated);
      setRepos(res.repos);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newUrl.trim()) return;
    const isFirst = repos.length === 0;
    const updated = [...repos, { label: newLabel.trim(), url: newUrl.trim(), defaultBranch: newBranch.trim() || 'main', isDefault: isFirst }];
    saveRepos(updated);
    setNewLabel('');
    setNewUrl('');
    setNewBranch('main');
  }

  function handleDelete(index: number) {
    const updated = repos.filter((_, i) => i !== index);
    // If we deleted the default, make the first remaining one default
    if (updated.length > 0 && !updated.some((r) => r.isDefault)) {
      updated[0].isDefault = true;
    }
    saveRepos(updated);
  }

  function handleSetDefault(index: number) {
    const updated = repos.map((r, i) => ({ ...r, isDefault: i === index }));
    saveRepos(updated);
  }

  if (loading) {
    return <div className="text-slate-500 py-4">Loading project repos...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Project Repositories</h2>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Repo list */}
      {repos.length > 0 && (
        <div className="space-y-2">
          {repos.map((repo, i) => (
            <div
              key={i}
              className="bg-slate-800 rounded-lg p-3 flex items-center gap-3"
            >
              <button
                onClick={() => handleSetDefault(i)}
                disabled={saving}
                className="flex-shrink-0 text-lg disabled:opacity-50"
                title={repo.isDefault ? 'Default repo' : 'Set as default'}
              >
                {repo.isDefault ? (
                  <span className="text-amber-400">&#9733;</span>
                ) : (
                  <span className="text-slate-600 hover:text-amber-400 transition-colors">&#9734;</span>
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{repo.label}</div>
                <code className="text-xs text-slate-400 font-mono break-all">{repo.url}</code>
                <span className="text-xs text-slate-500 ml-2">({repo.defaultBranch})</span>
              </div>

              <button
                onClick={() => handleDelete(i)}
                disabled={saving}
                className="flex-shrink-0 text-slate-500 hover:text-red-400 disabled:opacity-50 transition-colors text-lg"
                title="Remove repo"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {repos.length === 0 && (
        <p className="text-sm text-slate-500">No project repos configured. Add one below.</p>
      )}

      {/* Add repo form */}
      <form onSubmit={handleAdd} className="space-y-2">
        <input
          type="text"
          placeholder="Label (e.g. My Project)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          placeholder="Repository URL (e.g. https://github.com/user/repo.git)"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          placeholder="Default branch (e.g. main)"
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={saving || !newLabel.trim() || !newUrl.trim()}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving...' : 'Add Repository'}
        </button>
      </form>

      {/* Help text */}
      <div className="text-xs text-slate-500 space-y-1">
        <p>
          Project repos appear as quick-select options when creating a new session.
        </p>
        <p>
          The starred repo is pre-selected as the default. Each session clones the repo into its own container.
        </p>
      </div>
    </div>
  );
}
