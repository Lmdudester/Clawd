import { useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';
import type { SessionMessage } from '@clawd/shared';
import { useWebSocket } from '../../hooks/useWebSocket';
import { api } from '../../lib/api';
import { StatusBadge } from '../common/StatusBadge';
import { MessageList } from './MessageList';
import { MessageInput } from '../input/MessageInput';
import { ApprovalBanner } from '../input/ApprovalBanner';
import { QuestionPanel } from '../input/QuestionPanel';

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

  // Collect streaming text for this session
  const streamingKey = Array.from(streamingTokens.keys()).find((k) => k.startsWith(`${id}:`));
  const streamingText = streamingKey ? streamingTokens.get(streamingKey) ?? '' : '';

  const isInputDisabled = session?.status === 'awaiting_approval' || session?.status === 'awaiting_answer' || session?.status === 'terminated';

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="text-slate-400 hover:text-white transition-colors text-lg"
        >
          &#8592;
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-medium text-white truncate">{session?.name ?? 'Session'}</h1>
          <p className="text-xs text-slate-500 truncate">{session?.cwd}</p>
        </div>
        {session && <StatusBadge status={session.status} />}
      </header>

      {/* Messages */}
      <MessageList messages={messages} streamingText={streamingText} />

      {/* Input area - transforms based on state */}
      {pendingApproval && session?.status === 'awaiting_approval' ? (
        <ApprovalBanner approval={pendingApproval} onApprove={handleApprove} />
      ) : pendingQuestion && session?.status === 'awaiting_answer' ? (
        <QuestionPanel question={pendingQuestion} onAnswer={handleAnswer} />
      ) : (
        <MessageInput onSend={handleSend} disabled={isInputDisabled} />
      )}
    </div>
  );
}
