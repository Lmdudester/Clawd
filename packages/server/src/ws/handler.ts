import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import { ConnectionManager } from './connection-manager.js';
import { MessageRouter } from './message-router.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { Notifier } from '../notifications/notifier.js';

export function setupWebSocket(server: Server, sessionManager: SessionManager, notifier?: Notifier): { connectionManager: ConnectionManager; wss: WebSocketServer } {
  const wss = new WebSocketServer({ noServer: true });
  const connectionManager = new ConnectionManager();
  const messageRouter = new MessageRouter(sessionManager, connectionManager);

  // Debounce result push notifications — only send if session stays idle for 3s
  const pendingResultPush = new Map<string, ReturnType<typeof setTimeout>>();

  // Only send push notification when notifications are enabled AND no one is viewing the session
  const shouldNotify = (sessionId: string) =>
    sessionManager.getSession(sessionId)?.info.notificationsEnabled &&
    !connectionManager.hasSubscribers(sessionId);

  // Wire session events to WebSocket broadcasts
  sessionManager.onEvent((sessionId, event, data) => {
    switch (event) {
      case 'session_update': {
        connectionManager.broadcastAll({ type: 'session_update', session: data });
        // Cancel pending result push if session starts running again (intermediate result)
        const status = (data as any).status;
        if (status === 'running' && pendingResultPush.has(sessionId)) {
          clearTimeout(pendingResultPush.get(sessionId));
          pendingResultPush.delete(sessionId);
        }
        break;
      }
      case 'messages':
        connectionManager.broadcast(sessionId, { type: 'messages', sessionId, messages: data });
        break;
      case 'stream':
        connectionManager.broadcast(sessionId, { type: 'stream', sessionId, ...(data as object) });
        break;
      case 'approval_request': {
        connectionManager.broadcast(sessionId, { type: 'approval_request', sessionId, approval: data });
        if (shouldNotify(sessionId)) {
          const sessionName = sessionManager.getSession(sessionId)?.info.name ?? sessionId;
          notifier?.sendNotification('Approval Needed', `Session "${sessionName}" needs approval`);
        }
        break;
      }
      case 'question': {
        connectionManager.broadcast(sessionId, { type: 'question', sessionId, question: data });
        if (shouldNotify(sessionId)) {
          const sessionName = sessionManager.getSession(sessionId)?.info.name ?? sessionId;
          notifier?.sendNotification('Question', `Session "${sessionName}" has a question`);
        }
        break;
      }
      case 'result': {
        connectionManager.broadcast(sessionId, { type: 'result', sessionId, ...(data as object) });
        // Clear any previous pending push for this session, then schedule a new one
        if (pendingResultPush.has(sessionId)) {
          clearTimeout(pendingResultPush.get(sessionId));
        }
        const sessionName = sessionManager.getSession(sessionId)?.info.name ?? sessionId;
        const timeout = setTimeout(() => {
          pendingResultPush.delete(sessionId);
          if (shouldNotify(sessionId)) {
            notifier?.sendNotification('Task Complete', `Session "${sessionName}" is idle`);
          }
        }, 3000);
        pendingResultPush.set(sessionId, timeout);
        break;
      }
      case 'models_list': {
        connectionManager.broadcast(sessionId, { type: 'models_list', sessionId, models: data });
        break;
      }
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', (data) => {
      messageRouter.handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      connectionManager.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
      connectionManager.removeClient(ws);
    });
  });

  return { connectionManager, wss };
}
