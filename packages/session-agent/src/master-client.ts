import WebSocket from 'ws';
import type { AgentToMasterMessage, MasterToAgentMessage } from '@clawd/shared';

type MessageHandler = (message: MasterToAgentMessage) => void;

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export class MasterClient {
  private ws: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private authenticated = false;
  private authResolve: (() => void) | null = null;
  private authReject: ((err: Error) => void) | null = null;
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private masterUrl: string,
    private sessionId: string,
    private sessionToken: string,
  ) {}

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    return this.connectInternal();
  }

  private connectInternal(): Promise<void> {
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
          this.reconnectAttempt = 0;
          this.authResolve?.();
          this.authResolve = null;
          this.authReject = null;
          return;
        }

        this.messageHandler?.(message);
      });

      this.ws.on('close', () => {
        console.log('[agent] Disconnected from master');
        const wasAuthenticated = this.authenticated;
        this.authenticated = false;
        this.ws = null;

        if (!wasAuthenticated && this.authReject) {
          // Never authenticated — reject the initial connect() promise
          this.authReject(new Error('Connection closed before auth'));
          this.authResolve = null;
          this.authReject = null;
          return;
        }

        // Attempt reconnection if we were previously connected and haven't been told to stop
        if (wasAuthenticated && this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[agent] WebSocket error:', err.message);
        if (!this.authenticated) {
          this.authReject?.(err);
          this.authResolve = null;
          this.authReject = null;
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt++;

    console.log(`[agent] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;

      try {
        await this.connectInternal();
      } catch (err) {
        console.error('[agent] Reconnection failed:', (err as Error).message);
        // connectInternal's close handler will schedule the next attempt
      }
    }, delay);
  }

  send(message: AgentToMasterMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }
}
