import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/sessionStore';
import { useNavigate } from 'react-router-dom';
import type { ProjectRepo } from '@clawd/shared';

export function NewSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<number | null>(null);
  const addSession = useSessionStore((s) => s.addSession);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    api.getProjectRepos()
      .then((res) => {
        setRepos(res.repos);
        const defaultIdx = res.repos.findIndex((r: ProjectRepo) => r.isDefault);
        if (defaultIdx >= 0) {
          setSelectedRepo(defaultIdx);
          setRepoUrl(res.repos[defaultIdx].url);
          setBranch(res.repos[defaultIdx].defaultBranch);
        }
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  function handleRepoSelect(index: number) {
    setSelectedRepo(index);
    setRepoUrl(repos[index].url);
    setBranch(repos[index].defaultBranch);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.createSession({ name, repoUrl, branch });
      addSession(res.session);
      navigate(`/session/${res.session.id}`);
      onClose();
      setName('');
      setRepoUrl('');
      setBranch('');
      setSelectedRepo(null);
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-4">New Session</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</div>
          )}

          <input
            type="text"
            placeholder="Session name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />

          {/* Repository dropdown */}
          {repos.length > 0 ? (
            <>
              <select
                value={selectedRepo === null ? 'other' : String(selectedRepo)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'other') {
                    setSelectedRepo(null);
                    setRepoUrl('');
                    setBranch('main');
                  } else {
                    handleRepoSelect(Number(val));
                  }
                }}
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {repos.map((repo, i) => (
                  <option key={i} value={i}>
                    {repo.label}{repo.isDefault ? ' \u2605' : ''}
                  </option>
                ))}
                <option value="other">Other...</option>
              </select>

              {selectedRepo === null && (
                <input
                  type="text"
                  placeholder="Repository URL (e.g. https://github.com/user/repo.git)"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              )}
            </>
          ) : (
            <input
              type="text"
              placeholder="Repository URL (e.g. https://github.com/user/repo.git)"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          )}

          <input
            type="text"
            placeholder="Branch (e.g. main)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name || !repoUrl || !branch}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
