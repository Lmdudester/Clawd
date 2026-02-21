import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, type ReactNode } from 'react';
import { useAuthStore } from './stores/authStore';
import { WebSocketContext, useWebSocket, useWebSocketProvider } from './hooks/useWebSocket';
import { LoginPage } from './components/auth/LoginPage';
import { SessionList } from './components/sessions/SessionList';
import { ChatView } from './components/chat/ChatView';
import { SettingsPage } from './components/settings/SettingsPage';
import { ToastContainer } from './components/ui/ToastContainer';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-bold text-red-400 mb-2">Something went wrong</h1>
            <pre className="text-sm text-slate-400 bg-slate-800 p-4 rounded-lg overflow-x-auto text-left whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.href = '/'; }}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg"
            >
              Go Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ConnectionStatusIndicator() {
  const { connectionStatus } = useWebSocket();
  if (connectionStatus === 'connected') return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-1.5 text-xs font-medium bg-yellow-600/90 text-white">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      {connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
    </div>
  );
}

function AuthenticatedApp() {
  const ws = useWebSocketProvider();
  return (
    <WebSocketContext.Provider value={ws}>
      <ConnectionStatusIndicator />
      <Routes>
        <Route path="/" element={<SessionList />} />
        <Route path="/session/:id" element={<ChatView />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer />
    </WebSocketContext.Provider>
  );
}

export function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return (
    <ErrorBoundary>
      <BrowserRouter>
        {isAuthenticated ? <AuthenticatedApp /> : <LoginPage />}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
