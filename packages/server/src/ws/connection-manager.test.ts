import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebSocket } from 'ws';
import { ConnectionManager } from './connection-manager.js';

function createMockWs(readyState = 1): WebSocket {
  return { readyState, send: vi.fn() } as unknown as WebSocket;
}

describe('ConnectionManager', () => {
  let cm: ConnectionManager;

  beforeEach(() => {
    cm = new ConnectionManager();
  });

  it('marks added clients as authenticated', () => {
    const ws = createMockWs();
    cm.addClient(ws, 'alice');
    expect(cm.isAuthenticated(ws)).toBe(true);
  });

  it('returns false for unknown WebSocket', () => {
    const ws = createMockWs();
    expect(cm.isAuthenticated(ws)).toBe(false);
  });

  it('removes client on removeClient', () => {
    const ws = createMockWs();
    cm.addClient(ws, 'alice');
    cm.removeClient(ws);
    expect(cm.isAuthenticated(ws)).toBe(false);
  });

  it('broadcasts only to subscribed clients', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    cm.addClient(ws1, 'alice');
    cm.addClient(ws2, 'bob');
    cm.subscribe(ws1, 'session-1');

    cm.broadcast('session-1', { type: 'update' });

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'update' }));
    expect(ws2.send).not.toHaveBeenCalled();
  });

  it('skips clients with closed WebSocket on broadcast', () => {
    const ws = createMockWs(3); // CLOSED state
    cm.addClient(ws, 'alice');
    cm.subscribe(ws, 'session-1');

    cm.broadcast('session-1', { type: 'update' });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('stops broadcasting to unsubscribed clients', () => {
    const ws = createMockWs();
    cm.addClient(ws, 'alice');
    cm.subscribe(ws, 'session-1');
    cm.unsubscribe(ws, 'session-1');

    cm.broadcast('session-1', { type: 'update' });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('broadcastAll sends to all authenticated clients', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    cm.addClient(ws1, 'alice');
    cm.addClient(ws2, 'bob');
    // No subscriptions needed

    cm.broadcastAll({ type: 'global' });

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'global' }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'global' }));
  });

  it('broadcastAll skips closed connections', () => {
    const ws = createMockWs(3);
    cm.addClient(ws, 'alice');

    cm.broadcastAll({ type: 'global' });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('hasSubscribers returns true with active subscriber', () => {
    const ws = createMockWs();
    cm.addClient(ws, 'alice');
    cm.subscribe(ws, 'session-1');

    expect(cm.hasSubscribers('session-1')).toBe(true);
  });

  it('hasSubscribers returns false with no subscribers', () => {
    expect(cm.hasSubscribers('session-1')).toBe(false);
  });

  it('hasSubscribers returns false when subscriber is disconnected', () => {
    const ws = createMockWs(3); // CLOSED
    cm.addClient(ws, 'alice');
    cm.subscribe(ws, 'session-1');

    expect(cm.hasSubscribers('session-1')).toBe(false);
  });
});
