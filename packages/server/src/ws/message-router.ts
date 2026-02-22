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

  /** Check if the WebSocket user owns the given session. */
  private isSessionOwner(ws: WebSocket, sessionId: string): boolean {
    const username = this.connectionManager.getUsername(ws);
    if (!username) return false;
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return false;
    return session.info.createdBy === username;
  }

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
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
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
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.sendMessage(message.sessionId, message.content);
        break;

      case 'approve_tool':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.approveToolUse(
          message.sessionId,
          message.approvalId,
          message.allow,
          message.message
        );
        break;

      case 'answer_question':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.answerQuestion(
          message.sessionId,
          message.questionId,
          message.answers
        );
        break;

      case 'interrupt':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.interruptSession(message.sessionId).catch((err) => {
          console.error(`WS: interrupt error for session ${message.sessionId}:`, err);
        });
        break;

      case 'pause_manager':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.pauseManager(message.sessionId).catch((err) => {
          console.error(`WS: pause_manager error for session ${message.sessionId}:`, err);
        });
        break;

      case 'resume_manager':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.resumeManager(message.sessionId);
        break;

      case 'update_session_settings':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.updateSessionSettings(message.sessionId, message.settings);
        break;

      case 'get_models':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.getSupportedModels(message.sessionId);
        break;

      case 'set_model':
        if (!this.isSessionOwner(ws, message.sessionId)) {
          ws.send(JSON.stringify({ type: 'error', sessionId: message.sessionId, message: 'Not authorized for this session' }));
          return;
        }
        this.sessionManager.setModel(message.sessionId, message.model);
        break;
    }
  }
}
