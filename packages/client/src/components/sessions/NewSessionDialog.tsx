import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../lib/api';
import { useSessionStore } from '../../stores/sessionStore';
import { useNavigate } from 'react-router-dom';
import type { ProjectRepo } from '@clawd/shared';

export function NewSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState('');
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<number | null>(null);

  // Branch dropdown state
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [isNewBranch, setIsNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [dockerAccess, setDockerAccess] = useState(false);

  const addSession = useSessionStore((s) => s.addSession);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const fetchBranches = useCallback((url: string, defaultBranch?: string) => {
    if (!url) return;
    setBranchesLoading(true);
    setBranches([]);
    setIsNewBranch(false);
    setNewBranchName('');
    api.getBranches(url)
      .then((res) => {
        setBranches(res.branches);
        // Pre-select the default branch if it exists in the list
        if (defaultBranch && res.branches.includes(defaultBranch)) {
          setBranch(defaultBranch);
        } else if (res.branches.length > 0) {
          setBranch(res.branches[0]);
        }
      })
      .catch(() => {
        setBranches([]);
      })
      .finally(() => setBranchesLoading(false));
  }, []);

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
          fetchBranches(res.repos[defaultIdx].url, res.repos[defaultIdx].defaultBranch);
        }
      })
      .catch(() => {});
  }, [open, fetchBranches]);

  if (!open) return null;

  function handleRepoSelect(index: number) {
    setSelectedRepo(index);
    setRepoUrl(repos[index].url);
    setBranch(repos[index].defaultBranch);
    fetchBranches(repos[index].url, repos[index].defaultBranch);
  }

  function handleBranchChange(value: string) {
    if (value === '__new__') {
      setIsNewBranch(true);
      setNewBranchName('');
      setBranch('');
    } else {
      setIsNewBranch(false);
      setNewBranchName('');
      setBranch(value);
    }
  }

  const effectiveBranch = isNewBranch ? newBranchName : branch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setLoading(true);
    try {
      // If creating a new branch, create it on GitHub first
      if (isNewBranch && newBranchName) {
        const defaultBranch = selectedRepo !== null
          ? repos[selectedRepo].defaultBranch
          : undefined;
        await api.createBranch({
          repoUrl,
          branchName: newBranchName,
          fromBranch: defaultBranch,
        });
      }

      const res = await api.createSession({ name, repoUrl, branch: effectiveBranch, dockerAccess });
      addSession(res.session);
      navigate(`/session/${res.session.id}`);
      onClose();
      setName('');
      setRepoUrl('');
      setBranch('');
      setBranches([]);
      setSelectedRepo(null);
      setIsNewBranch(false);
      setNewBranchName('');
      setDockerAccess(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 p-6"
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
                    setBranch('');
                    setBranches([]);
                    setIsNewBranch(false);
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
                  onBlur={() => {
                    if (repoUrl) fetchBranches(repoUrl);
                  }}
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
              onBlur={() => {
                if (repoUrl) fetchBranches(repoUrl);
              }}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          )}

          {/* Branch dropdown */}
          {branchesLoading ? (
            <div className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 text-sm">
              Loading branches...
            </div>
          ) : branches.length > 0 ? (
            <>
              <select
                value={isNewBranch ? '__new__' : branch}
                onChange={(e) => handleBranchChange(e.target.value)}
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="__new__">Create New Branch...</option>
              </select>

              {isNewBranch && (
                <input
                  type="text"
                  placeholder="New branch name"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              )}
            </>
          ) : (
            <input
              type="text"
              placeholder="Branch (e.g. main)"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          )}

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={dockerAccess}
              onChange={(e) => setDockerAccess(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            <div>
              <span className="text-sm text-white">Docker access</span>
              <p className="text-xs text-slate-400">Mount Docker socket for container management</p>
            </div>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              data-testid="cancel-session-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name || !repoUrl || !effectiveBranch}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
              data-testid="create-session-button"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
