// Internal WebSocket endpoint for session agent connections.
// Session containers connect here to proxy messages between the SDK and the master.

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import type { AgentToMasterMessage } from '@clawd/shared';
import type { SessionManager } from '../sessions/session-manager.js';

export function setupInternalWebSocket(server: Server, sessionManager: SessionManager): void {
  const wss = new WebSocketServer({ server, path: '/internal/session' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[internal-ws] Agent connected');
    let authenticatedSessionId: string | null = null;

    ws.on('message', (data) => {
      let message: AgentToMasterMessage;
      try {
        message = JSON.parse(data.toString());
      } catch {
        console.warn('[internal-ws] Received invalid JSON');
        return;
      }

      // Auth must be first message
      if (message.type === 'auth') {
        const valid = sessionManager.authenticateAgent(message.sessionId, message.token);
        if (valid) {
          authenticatedSessionId = message.sessionId;
          sessionManager.registerAgentConnection(message.sessionId, ws);
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          console.log(`[internal-ws] Agent authenticated for session ${message.sessionId}`);
        } else {
          console.warn(`[internal-ws] Auth failed for session ${message.sessionId}`);
          ws.close(4001, 'Authentication failed');
        }
        return;
      }

      if (!authenticatedSessionId) {
        console.warn('[internal-ws] Message before auth, closing');
        ws.close(4001, 'Not authenticated');
        return;
      }

      // Route all other messages to session manager
      sessionManager.handleAgentMessage(authenticatedSessionId, message);
    });

    ws.on('close', () => {
      if (authenticatedSessionId) {
        console.log(`[internal-ws] Agent disconnected for session ${authenticatedSessionId}`);
        sessionManager.unregisterAgentConnection(authenticatedSessionId);
      }
    });

    ws.on('error', (err) => {
      console.error('[internal-ws] Error:', err.message);
      if (authenticatedSessionId) {
        sessionManager.unregisterAgentConnection(authenticatedSessionId);
      }
    });
  });
}
