import type { WebSocket } from 'ws';
import type { ClientMessage } from '@clawd/shared';
import type { SessionManager } from '../sessions/session-manager.js';
import type { ConnectionManager } from './connection-manager.js';
import { verifyToken } from '../auth/middleware.js';

export class MessageRouter {
  constructor(
    private sessionManager: SessionManager,
    private connectionManager: ConnectionManager
  ) {}

  handleMessage(ws: WebSocket, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      console.warn('WS: received invalid JSON');
      ws.send(JSON.stringify({ type: 'error', sessionId: '', message: 'Invalid JSON' }));
      return;
    }

    try {
      this.routeMessage(ws, message);
    } catch (err) {
      console.error(`WS: error handling message type="${message.type}":`, err);
      ws.send(JSON.stringify({ type: 'error', sessionId: '', message: 'Internal server error' }));
    }
  }

  private routeMessage(ws: WebSocket, message: ClientMessage): void {
    // Auth must be first message
    if (message.type === 'auth') {
      const user = verifyToken(message.token);
      if (user) {
        console.log(`WS: authenticated user "${user.username}"`);
        this.connectionManager.addClient(ws, user.username);
        ws.send(JSON.stringify({ type: 'auth_ok' }));
      } else {
        console.warn('WS: auth failed — invalid token');
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
      }
      return;
    }

    // All other messages require auth
    if (!this.connectionManager.isAuthenticated(ws)) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Not authenticated' }));
      return;
    }

    switch (message.type) {
      case 'subscribe':
        this.connectionManager.subscribe(ws, message.sessionId);
        // Send current messages for this session
        const messages = this.sessionManager.getMessages(message.sessionId);
        if (messages.length > 0) {
          ws.send(JSON.stringify({ type: 'messages', sessionId: message.sessionId, messages }));
        }
        const session = this.sessionManager.getSession(message.sessionId);
        if (session) {
          ws.send(JSON.stringify({ type: 'session_update', session: session.info }));
          if (session.pendingApproval) {
            ws.send(JSON.stringify({
              type: 'approval_request',
              sessionId: message.sessionId,
              approval: session.pendingApproval,
            }));
          }
          if (session.pendingQuestion) {
            ws.send(JSON.stringify({
              type: 'question',
              sessionId: message.sessionId,
              question: session.pendingQuestion,
            }));
          }
        }
        break;

      case 'unsubscribe':
        this.connectionManager.unsubscribe(ws, message.sessionId);
        break;

      case 'send_prompt':
        this.sessionManager.sendMessage(message.sessionId, message.content);
        break;

      case 'approve_tool':
        this.sessionManager.approveToolUse(
          message.sessionId,
          message.approvalId,
          message.allow,
          message.message
        );
        break;

      case 'answer_question':
        this.sessionManager.answerQuestion(
          message.sessionId,
          message.questionId,
          message.answers
        );
        break;

      case 'interrupt':
        this.sessionManager.interruptSession(message.sessionId).catch((err) => {
          console.error(`WS: interrupt error for session ${message.sessionId}:`, err);
        });
        break;

      case 'update_session_settings':
        this.sessionManager.updateSessionSettings(message.sessionId, message.settings);
        break;

      case 'get_models':
        this.sessionManager.getSupportedModels(message.sessionId);
        break;

      case 'set_model':
        this.sessionManager.setModel(message.sessionId, message.model);
        break;
    }
  }
}
