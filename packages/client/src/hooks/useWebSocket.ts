import { useEffect, useRef, useCallback, useState, createContext, useContext } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useSessionStore } from '../stores/sessionStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { ClientMessage, ServerMessage } from '@clawd/shared';

type SendFn = (message: ClientMessage) => void;
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export const WebSocketContext = createContext<{ send: SendFn; connectionStatus: ConnectionStatus }>({
  send: () => {},
  connectionStatus: 'disconnected',
});

export function useWebSocket(): { send: SendFn; connectionStatus: ConnectionStatus } {
  return useContext(WebSocketContext);
}

export function useWebSocketProvider(): { send: SendFn; connectionStatus: ConnectionStatus } {
  const wsRef = useRef<WebSocket | null>(null);
  const wasConnected = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
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
  const addNotification = useNotificationStore((s) => s.addNotification);

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    setConnectionStatus('connecting');

    ws.onopen = () => {
      wasConnected.current = true;
      setConnectionStatus('connected');
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
          // Clear streaming tokens when a complete assistant message arrives,
          // so the streaming bubble doesn't linger alongside the real message
          if (message.messages.some((m: any) => m.type === 'assistant')) {
            clearSessionStreamTokens(message.sessionId);
          }
          break;
        case 'stream':
          appendStreamToken(message.sessionId, message.messageId, message.token);
          break;
        case 'stream_end':
          clearStreamTokens(message.sessionId, message.messageId);
          break;
        case 'approval_request':
          setPendingApproval(message.sessionId, message.approval);
          break;
        case 'question':
          setPendingQuestion(message.sessionId, message.question);
          break;
        case 'result':
          clearSessionStreamTokens(message.sessionId);
          setPendingApproval(message.sessionId, null);
          setPendingQuestion(message.sessionId, null);
          break;
        case 'models_list':
          setAvailableModels(message.models);
          break;
        case 'auth_alert':
          addNotification(
            message.status === 'refreshed' ? 'success' : 'error',
            message.message,
          );
          break;
        case 'error':
          console.error(`Session ${message.sessionId} error:`, message.message);
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      // If we had a working connection, just refresh the page —
      // it's faster and avoids the stale-state issues of in-place reconnection.
      if (wasConnected.current) {
        window.location.reload();
        return;
      }
      // Initial connection hasn't succeeded yet — retry with a short delay
      setConnectionStatus('reconnecting');
      reconnectTimer.current = setTimeout(connect, 1000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [token, logout, updateSession, addMessages, appendStreamToken, clearStreamTokens, clearSessionStreamTokens, setPendingApproval, setPendingQuestion, setAvailableModels, addNotification]);

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

  return { send, connectionStatus };
}
