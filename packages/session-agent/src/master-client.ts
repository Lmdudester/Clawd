import WebSocket from 'ws';
import type { AgentToMasterMessage, MasterToAgentMessage } from '@clawd/shared';

type MessageHandler = (message: MasterToAgentMessage) => void;

export class MasterClient {
  private ws: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private authenticated = false;
  private authResolve: (() => void) | null = null;
  private authReject: ((err: Error) => void) | null = null;

  constructor(
    private masterUrl: string,
    private sessionId: string,
    private sessionToken: string,
  ) {}

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[agent] Connecting to master at ${this.masterUrl}...`);
      this.ws = new WebSocket(this.masterUrl);

      this.ws.on('open', () => {
        console.log('[agent] Connected to master, authenticating...');
        this.authResolve = resolve;
        this.authReject = reject;
        this.send({ type: 'auth', sessionId: this.sessionId, token: this.sessionToken });
      });

      this.ws.on('message', (data) => {
        let message: MasterToAgentMessage;
        try {
          message = JSON.parse(data.toString());
        } catch {
          console.warn('[agent] Received invalid JSON from master');
          return;
        }

        if (message.type === 'auth_ok') {
          console.log('[agent] Authenticated with master');
          this.authenticated = true;
          this.authResolve?.();
          this.authResolve = null;
          this.authReject = null;
          return;
        }

        this.messageHandler?.(message);
      });

      this.ws.on('close', () => {
        console.log('[agent] Disconnected from master');
        if (!this.authenticated) {
          this.authReject?.(new Error('Connection closed before auth'));
        }
        this.ws = null;
      });

      this.ws.on('error', (err) => {
        console.error('[agent] WebSocket error:', err.message);
        if (!this.authenticated) {
          this.authReject?.(err);
        }
      });
    });
  }

  send(message: AgentToMasterMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.ws?.close();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }
}
