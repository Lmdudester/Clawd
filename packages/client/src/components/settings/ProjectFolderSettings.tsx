import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import type { ProjectFolder } from '@clawd/shared';

export function ProjectFolderSettings() {
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');

  useEffect(() => {
    api.getProjectFolders()
      .then((res) => setFolders(res.folders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function saveFolders(updated: ProjectFolder[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await api.setProjectFolders(updated);
      setFolders(res.folders);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newPath.trim()) return;
    const isFirst = folders.length === 0;
    const updated = [...folders, { label: newLabel.trim(), path: newPath.trim(), isDefault: isFirst }];
    saveFolders(updated);
    setNewLabel('');
    setNewPath('');
  }

  function handleDelete(index: number) {
    const updated = folders.filter((_, i) => i !== index);
    // If we deleted the default, make the first remaining one default
    if (updated.length > 0 && !updated.some((f) => f.isDefault)) {
      updated[0].isDefault = true;
    }
    saveFolders(updated);
  }

  function handleSetDefault(index: number) {
    const updated = folders.map((f, i) => ({ ...f, isDefault: i === index }));
    saveFolders(updated);
  }

  if (loading) {
    return <div className="text-slate-500 py-4">Loading project folders...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Project Folders</h2>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Folder list */}
      {folders.length > 0 && (
        <div className="space-y-2">
          {folders.map((folder, i) => (
            <div
              key={i}
              className="bg-slate-800 rounded-lg p-3 flex items-center gap-3"
            >
              <button
                onClick={() => handleSetDefault(i)}
                disabled={saving}
                className="flex-shrink-0 text-lg disabled:opacity-50"
                title={folder.isDefault ? 'Default folder' : 'Set as default'}
              >
                {folder.isDefault ? (
                  <span className="text-amber-400">&#9733;</span>
                ) : (
                  <span className="text-slate-600 hover:text-amber-400 transition-colors">&#9734;</span>
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{folder.label}</div>
                <code className="text-xs text-slate-400 font-mono break-all">{folder.path}</code>
              </div>

              <button
                onClick={() => handleDelete(i)}
                disabled={saving}
                className="flex-shrink-0 text-slate-500 hover:text-red-400 disabled:opacity-50 transition-colors text-lg"
                title="Remove folder"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {folders.length === 0 && (
        <p className="text-sm text-slate-500">No project folders configured. Add one below.</p>
      )}

      {/* Add folder form */}
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
          placeholder="Path (e.g. C:\Users\me\projects\app)"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={saving || !newLabel.trim() || !newPath.trim()}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving...' : 'Add Folder'}
        </button>
      </form>

      {/* Help text */}
      <div className="text-xs text-slate-500 space-y-1">
        <p>
          Project folders appear as quick-select options when creating a new session.
        </p>
        <p>
          The starred folder is pre-selected as the default working directory.
        </p>
      </div>
    </div>
  );
}
