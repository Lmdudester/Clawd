import { useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useSessionStore } from '../stores/sessionStore';
import type { ClientMessage, ServerMessage } from '@clawd/shared';

const WS_RECONNECT_BASE = 1000;
const WS_RECONNECT_MAX = 30000;

type SendFn = (message: ClientMessage) => void;

export const WebSocketContext = createContext<{ send: SendFn }>({
  send: () => {},
});

export function useWebSocket(): { send: SendFn } {
  return useContext(WebSocketContext);
}

export function useWebSocketProvider(): { send: SendFn } {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  const updateSession = useSessionStore((s) => s.updateSession);
  const addMessages = useSessionStore((s) => s.addMessages);
  const appendStreamToken = useSessionStore((s) => s.appendStreamToken);
  const clearStreamTokens = useSessionStore((s) => s.clearStreamTokens);
  const clearSessionStreamTokens = useSessionStore((s) => s.clearSessionStreamTokens);
  const setPendingApproval = useSessionStore((s) => s.setPendingApproval);
  const setPendingQuestion = useSessionStore((s) => s.setPendingQuestion);
  const setAvailableModels = useSessionStore((s) => s.setAvailableModels);

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempt.current = 0;
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (message.type) {
        case 'auth_ok':
          break;
        case 'auth_error':
          logout();
          break;
        case 'session_update':
          updateSession(message.session);
          break;
        case 'messages':
          addMessages(message.sessionId, message.messages);
          break;
        case 'stream':
          appendStreamToken(message.sessionId, message.messageId, message.token);
          break;
        case 'stream_end':
          clearStreamTokens(message.sessionId, message.messageId);
          break;
        case 'approval_request':
          setPendingApproval(message.approval);
          break;
        case 'question':
          setPendingQuestion(message.question);
          break;
        case 'result':
          clearSessionStreamTokens(message.sessionId);
          setPendingApproval(null);
          setPendingQuestion(null);
          break;
        case 'models_list':
          setAvailableModels(message.models);
          break;
        case 'error':
          console.error(`Session ${message.sessionId} error:`, message.message);
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      const delay = Math.min(
        WS_RECONNECT_BASE * Math.pow(2, reconnectAttempt.current),
        WS_RECONNECT_MAX
      );
      reconnectAttempt.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [token, logout, updateSession, addMessages, appendStreamToken, clearStreamTokens, clearSessionStreamTokens, setPendingApproval, setPendingQuestion, setAvailableModels]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { send };
}
