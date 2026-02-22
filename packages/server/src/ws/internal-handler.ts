// Internal WebSocket endpoint for session agent connections.
// Session containers connect here to proxy messages between the SDK and the master.

import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentToMasterMessage } from '@clawd/shared';
import type { SessionManager } from '../sessions/session-manager.js';

const INTERNAL_AUTH_TIMEOUT_MS = 30_000;

export function setupInternalWebSocket(sessionManager: SessionManager): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[internal-ws] Agent connected');
    let authenticatedSessionId: string | null = null;

    // Close the connection if the agent doesn't authenticate within the timeout
    const authTimeout = setTimeout(() => {
      if (!authenticatedSessionId) {
        console.warn('[internal-ws] Closing unauthenticated agent connection after timeout');
        ws.close(4001, 'Authentication timeout');
      }
    }, INTERNAL_AUTH_TIMEOUT_MS);

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
          clearTimeout(authTimeout);
          sessionManager.registerAgentConnection(message.sessionId, ws);
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          console.log(`[internal-ws] Agent authenticated for session ${message.sessionId}`);
        } else {
          console.warn(`[internal-ws] Auth failed for session ${message.sessionId}`);
          clearTimeout(authTimeout);
          ws.close(4001, 'Authentication failed');
        }
        return;
      }

      if (!authenticatedSessionId) {
        console.warn('[internal-ws] Message before auth, closing');
        clearTimeout(authTimeout);
        ws.close(4001, 'Not authenticated');
        return;
      }

      // Route all other messages to session manager
      sessionManager.handleAgentMessage(authenticatedSessionId, message);
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (authenticatedSessionId) {
        console.log(`[internal-ws] Agent disconnected for session ${authenticatedSessionId}`);
        sessionManager.unregisterAgentConnection(authenticatedSessionId);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(authTimeout);
      console.error('[internal-ws] Error:', err.message);
      if (authenticatedSessionId) {
        sessionManager.unregisterAgentConnection(authenticatedSessionId);
      }
    });
  });

  return wss;
}
