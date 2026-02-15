import { useState, useEffect } from 'react';
import type { SessionInfo, PermissionMode, ModelInfo } from '@clawd/shared';
import { MODE_THEME } from '../../lib/mode-theme';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  session: SessionInfo;
  onUpdateSettings: (settings: { name?: string; permissionMode?: PermissionMode; notificationsEnabled?: boolean }) => void;
  onChangeModel: (model: string) => void;
  availableModels: ModelInfo[];
  onRequestModels: () => void;
}

const PERMISSION_MODES: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Prompt for each tool' },
  { value: 'plan', label: 'Plan', description: 'Deny tools, plan only' },
  { value: 'auto_edits', label: 'Auto-Edits', description: 'Auto-approve file edits in project' },
  { value: 'dangerous', label: 'Dangerous', description: 'Auto-approve all tools' },
];

export function SettingsDialog({ open, onClose, session, onUpdateSettings, onChangeModel, availableModels, onRequestModels }: SettingsDialogProps) {
  const [name, setName] = useState(session.name);
  useEffect(() => {
    if (open) {
      setName(session.name);
      onRequestModels();
    }
  }, [open, session.name, onRequestModels]);

  if (!open) return null;

  function handleNameCommit() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== session.name) {
      onUpdateSettings({ name: trimmed });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-5">Session Settings</h2>

        <div className="space-y-5">
          {/* Session Name */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Session Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameCommit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNameCommit(); }}
              className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Model</label>
            {(() => {
              // Match current model ID (e.g. "claude-opus-4-6") to available model entry
              // Values from SDK are "default", "sonnet", "haiku" while session.model is "claude-opus-4-6"
              // Match by: exact value, value substring, or description containing the model family
              const modelId = session.model ?? '';
              const currentMatch = modelId && availableModels.length > 0
                ? availableModels.find((m) =>
                    m.value === modelId ||
                    modelId.includes(m.value) ||
                    m.value.includes(modelId) ||
                    m.description.toLowerCase().split(/\s+/).some((word) => modelId.includes(word) && word.length > 3)
                  )
                : null;
              const modelsReady = availableModels.length > 0 && currentMatch;
              return modelsReady ? (
                <select
                  value={currentMatch.value}
                  onChange={(e) => {
                    if (e.target.value) {
                      onChangeModel(e.target.value);
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  {availableModels.map((m) => {
                    const modelName = m.description.split('·')[0]?.trim() || m.displayName;
                    return (
                      <option key={m.value} value={m.value} title={m.description}>
                        {modelName}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <div className="px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 text-sm">
                  {session.model ?? 'Loading models...'}
                </div>
              );
            })()}
          </div>

          {/* Permission Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Permission Mode</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-600">
              {PERMISSION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => onUpdateSettings({ permissionMode: mode.value })}
                  title={mode.description}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                    session.permissionMode === mode.value
                      ? MODE_THEME[mode.value].toggle
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Notifications</label>
            <button
              onClick={() => onUpdateSettings({ notificationsEnabled: !session.notificationsEnabled })}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                session.notificationsEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {session.notificationsEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
