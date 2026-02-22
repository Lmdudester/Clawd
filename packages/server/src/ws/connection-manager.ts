import type { WebSocket } from 'ws';

interface Client {
  ws: WebSocket;
  username: string;
  subscriptions: Set<string>;
}

export class ConnectionManager {
  private clients = new Map<WebSocket, Client>();

  addClient(ws: WebSocket, username: string): void {
    this.clients.set(ws, { ws, username, subscriptions: new Set() });
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  subscribe(ws: WebSocket, sessionId: string): void {
    this.clients.get(ws)?.subscriptions.add(sessionId);
  }

  unsubscribe(ws: WebSocket, sessionId: string): void {
    this.clients.get(ws)?.subscriptions.delete(sessionId);
  }

  // Broadcast a message to all clients subscribed to a session
  broadcast(sessionId: string, message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(sessionId) && client.ws.readyState === 1) {
        try {
          client.ws.send(data);
        } catch {
          // WebSocket transitioned from OPEN to CLOSING between the check and send — safe to ignore
        }
      }
    }
  }

  // Broadcast a message to all authenticated clients (regardless of session subscription)
  broadcastAll(message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) {
        try {
          client.ws.send(data);
        } catch {
          // WebSocket transitioned from OPEN to CLOSING between the check and send — safe to ignore
        }
      }
    }
  }

  // Broadcast a message only to clients authenticated as the given username
  broadcastToUser(username: string, message: object): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.username === username && client.ws.readyState === 1) {
        try {
          client.ws.send(data);
        } catch {
          // WebSocket transitioned from OPEN to CLOSING between the check and send — safe to ignore
        }
      }
    }
  }

  // Check if any connected client has an open WebSocket subscribed to this session
  hasSubscribers(sessionId: string): boolean {
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(sessionId) && client.ws.readyState === 1) {
        return true;
      }
    }
    return false;
  }

  isAuthenticated(ws: WebSocket): boolean {
    return this.clients.has(ws);
  }

  getUsername(ws: WebSocket): string | null {
    return this.clients.get(ws)?.username ?? null;
  }
}
