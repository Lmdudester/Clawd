import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import { ConnectionManager } from './connection-manager.js';
import { MessageRouter } from './message-router.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { PushManager } from '../push/push-manager.js';

export function setupWebSocket(server: Server, sessionManager: SessionManager, pushManager?: PushManager): ConnectionManager {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connectionManager = new ConnectionManager();
  const messageRouter = new MessageRouter(sessionManager, connectionManager);

  // Debounce result push notifications — only send if session stays idle for 3s
  const pendingResultPush = new Map<string, ReturnType<typeof setTimeout>>();

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
      case 'approval_request':
        connectionManager.broadcast(sessionId, { type: 'approval_request', sessionId, approval: data });
        pushManager?.sendNotification('Approval Needed', `${(data as any).toolName} requires approval`, `/session/${sessionId}`);
        break;
      case 'question':
        connectionManager.broadcast(sessionId, { type: 'question', sessionId, question: data });
        pushManager?.sendNotification('Claude has a question', 'Tap to respond', `/session/${sessionId}`);
        break;
      case 'result': {
        connectionManager.broadcast(sessionId, { type: 'result', sessionId, ...(data as object) });
        // Clear any previous pending push for this session, then schedule a new one
        if (pendingResultPush.has(sessionId)) {
          clearTimeout(pendingResultPush.get(sessionId));
        }
        const resultText = (data as any).result ?? 'Claude finished working';
        const timeout = setTimeout(() => {
          pendingResultPush.delete(sessionId);
          pushManager?.sendNotification('Task Complete', resultText, `/session/${sessionId}`);
        }, 3000);
        pendingResultPush.set(sessionId, timeout);
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

  return connectionManager;
}
