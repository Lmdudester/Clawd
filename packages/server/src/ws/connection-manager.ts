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
        client.ws.send(data);
      }
    }
  }

  isAuthenticated(ws: WebSocket): boolean {
    return this.clients.has(ws);
  }
}
