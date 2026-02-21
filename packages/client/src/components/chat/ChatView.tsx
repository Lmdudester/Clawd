import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';
import type { SessionMessage, SessionSettingsUpdate } from '@clawd/shared';
import { useWebSocket } from '../../hooks/useWebSocket';
import { api } from '../../lib/api';
import { getReconnectDelay } from '../../lib/reconnect';
import { StatusBadge } from '../common/StatusBadge';
import { MessageList } from './MessageList';
import { MessageInput } from '../input/MessageInput';
import { ApprovalBanner } from '../input/ApprovalBanner';
import { QuestionPanel } from '../input/QuestionPanel';
import { SettingsDialog } from './SettingsDialog';
import { MODE_THEME } from '../../lib/mode-theme';

const EMPTY_MESSAGES: SessionMessage[] = [];

export function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { send } = useWebSocket();

  const sessions = useSessionStore((s) => s.sessions);
  const session = sessions.find((s) => s.id === id);
  const messages = useSessionStore((s) => s.messages.get(id ?? '')) ?? EMPTY_MESSAGES;
  const pendingApproval = useSessionStore((s) => id ? s.pendingApprovals.get(id) ?? null : null);
  const pendingQuestion = useSessionStore((s) => id ? s.pendingQuestions.get(id) ?? null : null);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setMessages = useSessionStore((s) => s.setMessages);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setPendingApproval = useSessionStore((s) => s.setPendingApproval);
  const setPendingQuestion = useSessionStore((s) => s.setPendingQuestion);

  const [sessionNotFound, setSessionNotFound] = useState(false);

  // Subscribe to session on mount
  useEffect(() => {
    if (!id) return;
    setCurrentSession(id);
    send({ type: 'subscribe', sessionId: id });

    // Load session details via REST as a reliable fallback (the WebSocket
    // subscribe may be dropped if the connection isn't ready yet)
    api.getSession(id).then((res) => {
      updateSession(res.session);
      setMessages(id, res.messages);
    }).catch((err) => {
      if (err.message === 'Session not found') {
        setSessionNotFound(true);
      }
    });

    // Retry subscribe with exponential backoff in case the WebSocket
    // wasn't connected when the first subscribe was sent
    let retryAttempt = 0;
    const maxRetries = 4;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = () => {
      if (retryAttempt >= maxRetries) return;
      const delay = getReconnectDelay(retryAttempt, 500, 8000);
      retryAttempt++;
      retryTimer = setTimeout(() => {
        send({ type: 'subscribe', sessionId: id });
        scheduleRetry();
      }, delay);
    };
    scheduleRetry();

    return () => {
      clearTimeout(retryTimer);
      send({ type: 'unsubscribe', sessionId: id });
      setCurrentSession(null);
    };
  }, [id, send, setCurrentSession, setMessages, updateSession]);

  const handleSend = useCallback((content: string) => {
    if (!id) return;
    send({ type: 'send_prompt', sessionId: id, content });
  }, [id, send]);

  const handleApprove = useCallback((approvalId: string, allow: boolean) => {
    if (!id) return;
    send({ type: 'approve_tool', sessionId: id, approvalId, allow });
  }, [id, send]);

  const handleAnswer = useCallback((questionId: string, answers: Record<string, string>) => {
    if (!id) return;
    send({ type: 'answer_question', sessionId: id, questionId, answers });
  }, [id, send]);

  const handleInterrupt = useCallback(() => {
    if (!id) return;
    send({ type: 'interrupt', sessionId: id });
    setPendingApproval(id, null);
    setPendingQuestion(id, null);
  }, [id, send, setPendingApproval, setPendingQuestion]);

  const handlePauseManager = useCallback(() => {
    if (!id) return;
    send({ type: 'pause_manager', sessionId: id });
  }, [id, send]);

  const handleResumeManager = useCallback(() => {
    if (!id) return;
    send({ type: 'resume_manager', sessionId: id });
  }, [id, send]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleUpdateSettings = useCallback((settings: SessionSettingsUpdate) => {
    if (!id) return;
    send({ type: 'update_session_settings', sessionId: id, settings });
  }, [id, send]);

  const availableModels = useSessionStore((s) => s.availableModels);

  const handleChangeModel = useCallback((model: string) => {
    if (!id) return;
    send({ type: 'set_model', sessionId: id, model });
  }, [id, send]);

  const handleRequestModels = useCallback(() => {
    if (!id) return;
    send({ type: 'get_models', sessionId: id });
  }, [id, send]);

  // Collect streaming text for this session — use a narrow selector to avoid
  // re-rendering the entire ChatView on every streaming token for other sessions
  const streamingText = useSessionStore((s) => {
    for (const [key, value] of s.streamingTokens) {
      if (key.startsWith(`${id}:`)) return value;
    }
    return '';
  });

  const isInputDisabled = session?.status === 'awaiting_approval' || session?.status === 'awaiting_answer' || session?.status === 'terminated' || session?.status === 'starting' || session?.status === 'error';
  const isInterruptible = session?.status === 'running' || session?.status === 'awaiting_approval' || session?.status === 'awaiting_answer';
  const isManagerPaused = !!session?.isManager && !!session?.managerState?.paused;

  if (sessionNotFound) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-950 p-4">
        <h1 className="text-xl font-bold text-red-400 mb-2">Session not found</h1>
        <p className="text-slate-400 mb-6">This session does not exist or has been deleted.</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Back to Sessions
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="text-slate-200 hover:text-white transition-colors text-xl border border-slate-500 rounded w-8 h-8 flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 flex items-center">
          {session?.isManager && (
            <span className="inline-block text-xs font-semibold text-purple-300 bg-purple-500/20 border border-purple-500/30 px-1.5 py-0.5 rounded mr-2 shrink-0">Manager</span>
          )}
          {session?.managedBy && (
            <span className="inline-block text-xs font-semibold text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded mr-2 shrink-0">Managed</span>
          )}
          {session?.managerState && (
            <span className="inline-block text-xs font-semibold text-purple-300 bg-purple-500/20 border border-purple-500/30 px-1.5 py-0.5 rounded mr-2 shrink-0 capitalize">
              {session.managerState.currentStep}
            </span>
          )}
          {session?.managerState && session.managerState.childSessionIds.length > 0 && (
            <span className="inline-block text-xs text-slate-400 mr-2 shrink-0">
              {session.managerState.childSessionIds.length} child{session.managerState.childSessionIds.length !== 1 ? 'ren' : ''}
            </span>
          )}
          {session?.isManager && session?.status !== 'terminated' && session?.status !== 'error' && (
            <button
              onClick={isManagerPaused ? handleResumeManager : handlePauseManager}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border transition-colors mr-2 shrink-0 ${
                isManagerPaused
                  ? 'text-green-300 bg-green-500/20 border-green-500/30 hover:bg-green-500/30'
                  : 'text-amber-300 bg-amber-500/20 border-amber-500/30 hover:bg-amber-500/30'
              }`}
              title={isManagerPaused ? 'Resume manager auto-continue' : 'Pause manager auto-continue'}
            >
              {isManagerPaused ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z" />
                  </svg>
                  Resume
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5Zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5Z" />
                  </svg>
                  Pause
                </>
              )}
            </button>
          )}
          <h1 className="text-lg font-medium text-white truncate">{session?.name ?? 'Session'}</h1>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1.5">
            {session?.notificationsEnabled && (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400" aria-label="Notifications enabled">
                <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z" clipRule="evenodd" />
              </svg>
            )}
            {session && <StatusBadge status={session.status} />}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-slate-300 bg-blue-950/40 border border-blue-800/50 px-2 py-0.5 rounded truncate max-w-[150px]">{session?.repoUrl.split('/').filter(Boolean).pop()?.replace(/\.git$/, '')}</span>
            <span className="text-sm text-slate-400 bg-slate-800/60 border border-slate-700/50 px-1.5 py-0.5 rounded font-mono text-xs">{session?.branch}</span>
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-slate-200 hover:text-white transition-colors border border-slate-500 rounded w-8 h-8 flex items-center justify-center shrink-0"
          title="Session settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M19 5.5a4.5 4.5 0 0 1-4.791 4.49c-.873-.055-1.808.128-2.368.8l-6.024 7.23a2.724 2.724 0 1 1-3.837-3.837L9.21 8.16c.672-.56.855-1.495.8-2.368a4.5 4.5 0 0 1 5.873-4.575c.324.105.39.51.15.752L13.34 4.66a.455.455 0 0 0-.11.494 3.01 3.01 0 0 0 1.617 1.617c.17.07.363.02.493-.111l2.692-2.692c.241-.241.647-.174.752.15.14.435.216.9.216 1.382ZM4 17a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          </svg>
        </button>
      </header>

      {/* Messages */}
      <MessageList messages={messages} streamingText={streamingText} />

      {/* Permission mode status bar */}
      {session?.permissionMode === 'auto_edits' && (
        <div key="mode-edits" className={`px-4 py-1.5 ${MODE_THEME.auto_edits.banner} text-xs font-medium text-center shrink-0`}>
          Auto-Edits — file edits in project will be approved automatically
        </div>
      )}
      {session?.permissionMode === 'dangerous' && !session?.isManager && (
        <div key="mode-danger" className={`px-4 py-1.5 ${MODE_THEME.dangerous.banner} text-xs font-medium text-center shrink-0`}>
          Dangerous — all tools will be approved automatically
        </div>
      )}
      {session?.permissionMode === 'plan' && (
        <div key="mode-plan" className={`px-4 py-1.5 ${MODE_THEME.plan.banner} text-xs font-medium text-center shrink-0`}>
          Plan Mode — read-only, edits are disabled
        </div>
      )}

      {/* Manager session banner */}
      {session?.isManager && (
        <div className={`px-4 py-1.5 ${
          isManagerPaused
            ? 'bg-amber-500/10 border-t border-amber-500/20 text-amber-300'
            : 'bg-purple-500/10 border-t border-purple-500/20 text-purple-300'
        } text-xs font-medium text-center shrink-0`}>
          {isManagerPaused
            ? 'Manager session paused — auto-continue is suspended'
            : 'Autonomous manager session — messages will guide the orchestration loop'}
        </div>
      )}

      {/* Input area - transforms based on state */}
      {pendingApproval && session?.status === 'awaiting_approval' ? (
        <ApprovalBanner approval={pendingApproval} onApprove={handleApprove} onInterrupt={handleInterrupt} />
      ) : pendingQuestion && session?.status === 'awaiting_answer' ? (
        <QuestionPanel question={pendingQuestion} onAnswer={handleAnswer} onInterrupt={handleInterrupt} />
      ) : (
        <MessageInput onSend={handleSend} disabled={isInputDisabled} isInterruptible={isInterruptible} onInterrupt={handleInterrupt} />
      )}

      {session && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          session={session}
          onUpdateSettings={handleUpdateSettings}
          onUpdateSessionOptimistic={updateSession}
          onChangeModel={handleChangeModel}
          availableModels={availableModels}
          onRequestModels={handleRequestModels}
        />
      )}
    </div>
  );
}
