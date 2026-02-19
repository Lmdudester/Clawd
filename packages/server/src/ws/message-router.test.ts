import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { WebSocket } from 'ws';
import { ConnectionManager } from './connection-manager.js';
import { MessageRouter } from './message-router.js';

const TEST_SECRET = 'test-jwt-secret-for-router';

vi.mock('../config.js', () => ({
  config: { jwtSecret: 'test-jwt-secret-for-router' },
}));

function createMockWs(): WebSocket {
  return {
    readyState: 1,
    send: vi.fn(),
  } as unknown as WebSocket;
}

function createMockSessionManager() {
  return {
    getSessions: vi.fn(() => []),
    getSession: vi.fn((id: string) => ({
      info: { id, name: 'Test', status: 'idle' },
      pendingApproval: null,
      pendingQuestion: null,
    })),
    getMessages: vi.fn(() => []),
    sendMessage: vi.fn(),
    approveToolUse: vi.fn(),
    answerQuestion: vi.fn(),
    interruptSession: vi.fn(async () => {}),
    updateSessionSettings: vi.fn(),
    getSupportedModels: vi.fn(),
    setModel: vi.fn(),
  } as any;
}

describe('MessageRouter', () => {
  let cm: ConnectionManager;
  let sm: ReturnType<typeof createMockSessionManager>;
  let router: MessageRouter;

  beforeEach(() => {
    cm = new ConnectionManager();
    sm = createMockSessionManager();
    router = new MessageRouter(sm, cm);
  });

  it('authenticates user with valid token', () => {
    const ws = createMockWs();
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });

    router.handleMessage(ws, JSON.stringify({ type: 'auth', token }));

    expect(cm.isAuthenticated(ws)).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('auth_ok'));
  });

  it('rejects auth with invalid token', () => {
    const ws = createMockWs();

    router.handleMessage(ws, JSON.stringify({ type: 'auth', token: 'bad-token' }));

    expect(cm.isAuthenticated(ws)).toBe(false);
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('auth_error'));
  });

  it('rejects non-auth messages before authentication', () => {
    const ws = createMockWs();

    router.handleMessage(ws, JSON.stringify({ type: 'subscribe', sessionId: 's1' }));

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('auth_error'));
  });

  it('handles subscribe after auth', () => {
    const ws = createMockWs();
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });
    router.handleMessage(ws, JSON.stringify({ type: 'auth', token }));

    router.handleMessage(ws, JSON.stringify({ type: 'subscribe', sessionId: 's1' }));

    expect(cm.hasSubscribers('s1')).toBe(true);
  });

  it('routes send_prompt to sessionManager', () => {
    const ws = createMockWs();
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });
    router.handleMessage(ws, JSON.stringify({ type: 'auth', token }));

    router.handleMessage(ws, JSON.stringify({
      type: 'send_prompt',
      sessionId: 's1',
      content: 'Hello',
    }));

    expect(sm.sendMessage).toHaveBeenCalledWith('s1', 'Hello');
  });

  it('routes approve_tool to sessionManager', () => {
    const ws = createMockWs();
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });
    router.handleMessage(ws, JSON.stringify({ type: 'auth', token }));

    router.handleMessage(ws, JSON.stringify({
      type: 'approve_tool',
      sessionId: 's1',
      approvalId: 'a1',
      allow: true,
    }));

    expect(sm.approveToolUse).toHaveBeenCalledWith('s1', 'a1', true, undefined);
  });

  it('routes interrupt to sessionManager', () => {
    const ws = createMockWs();
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });
    router.handleMessage(ws, JSON.stringify({ type: 'auth', token }));

    router.handleMessage(ws, JSON.stringify({
      type: 'interrupt',
      sessionId: 's1',
    }));

    expect(sm.interruptSession).toHaveBeenCalledWith('s1');
  });

  it('handles invalid JSON gracefully', () => {
    const ws = createMockWs();

    router.handleMessage(ws, 'not json at all');

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });
});
