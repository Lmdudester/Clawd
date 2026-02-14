import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import { ConnectionManager } from './connection-manager.js';
import { MessageRouter } from './message-router.js';
import type { SessionManager } from '../sessions/session-manager.js';

export function setupWebSocket(server: Server, sessionManager: SessionManager): ConnectionManager {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connectionManager = new ConnectionManager();
  const messageRouter = new MessageRouter(sessionManager, connectionManager);

  // Wire session events to WebSocket broadcasts
  sessionManager.onEvent((sessionId, event, data) => {
    switch (event) {
      case 'session_update':
        connectionManager.broadcast(sessionId, { type: 'session_update', session: data });
        break;
      case 'messages':
        connectionManager.broadcast(sessionId, { type: 'messages', sessionId, messages: data });
        break;
      case 'stream':
        connectionManager.broadcast(sessionId, { type: 'stream', sessionId, ...(data as object) });
        break;
      case 'approval_request':
        connectionManager.broadcast(sessionId, { type: 'approval_request', sessionId, approval: data });
        break;
      case 'question':
        connectionManager.broadcast(sessionId, { type: 'question', sessionId, question: data });
        break;
      case 'result':
        connectionManager.broadcast(sessionId, { type: 'result', sessionId, ...(data as object) });
        break;
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
