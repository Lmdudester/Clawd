import { useNavigate } from 'react-router-dom';
import { AuthSettings } from './AuthSettings';
import { ProjectFolderSettings } from './ProjectFolderSettings';

export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-white transition-colors text-lg"
          >
            &#8592;
          </button>
          <h1 className="text-xl font-bold text-white">Settings</h1>
        </div>
      </header>

      {/* Content */}
      <main className="p-4 max-w-lg mx-auto space-y-8">
        <AuthSettings />
        <ProjectFolderSettings />
      </main>
    </div>
  );
}
