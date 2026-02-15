import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';
import type { SessionMessage, SessionSettingsUpdate } from '@clawd/shared';
import { useWebSocket } from '../../hooks/useWebSocket';
import { api } from '../../lib/api';
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
  const streamingTokens = useSessionStore((s) => s.streamingTokens);
  const pendingApproval = useSessionStore((s) => s.pendingApproval);
  const pendingQuestion = useSessionStore((s) => s.pendingQuestion);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setMessages = useSessionStore((s) => s.setMessages);
  const updateSession = useSessionStore((s) => s.updateSession);

  // Subscribe to session on mount
  useEffect(() => {
    if (!id) return;
    setCurrentSession(id);
    send({ type: 'subscribe', sessionId: id });

    // Load session details
    api.getSession(id).then((res) => {
      updateSession(res.session);
      setMessages(id, res.messages);
    }).catch(() => {});

    return () => {
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

  // Collect streaming text for this session
  const streamingKey = Array.from(streamingTokens.keys()).find((k) => k.startsWith(`${id}:`));
  const streamingText = streamingKey ? streamingTokens.get(streamingKey) ?? '' : '';

  const isInputDisabled = session?.status === 'awaiting_approval' || session?.status === 'awaiting_answer' || session?.status === 'terminated';
  const isInterruptible = session?.status === 'running' || session?.status === 'awaiting_approval' || session?.status === 'awaiting_answer';

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
          <span className="text-sm text-slate-300 bg-blue-950/40 border border-blue-800/50 px-2 py-0.5 rounded truncate max-w-[200px]">{session?.cwd.split(/[/\\]/).filter(Boolean).pop()}</span>
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
      {session?.permissionMode === 'dangerous' && (
        <div key="mode-danger" className={`px-4 py-1.5 ${MODE_THEME.dangerous.banner} text-xs font-medium text-center shrink-0`}>
          Dangerous — all tools will be approved automatically
        </div>
      )}
      {session?.permissionMode === 'plan' && (
        <div key="mode-plan" className={`px-4 py-1.5 ${MODE_THEME.plan.banner} text-xs font-medium text-center shrink-0`}>
          Plan Mode — read-only, edits are disabled
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
          onChangeModel={handleChangeModel}
          availableModels={availableModels}
          onRequestModels={handleRequestModels}
        />
      )}
    </div>
  );
}
