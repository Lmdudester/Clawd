import { v4 as uuid, v4 } from 'uuid';
import type { WebSocket } from 'ws';
import type {
  SessionInfo,
  SessionMessage,
  SessionStatus,
  PendingApproval,
  PendingQuestion,
  SessionSettingsUpdate,
  PermissionMode,
  AgentToMasterMessage,
  MasterToAgentMessage,
} from '@clawd/shared';
import type { CredentialStore } from '../settings/credential-store.js';
import type { ContainerManager, SessionContainerConfig } from './container-manager.js';

interface ManagedSession {
  info: SessionInfo;
  messages: SessionMessage[];
  containerId: string | null;
  agentWs: WebSocket | null;
  sessionToken: string;
  pendingApproval: PendingApproval | null;
  pendingQuestion: PendingQuestion | null;
}

type SessionEventHandler = (sessionId: string, event: string, data: unknown) => void;

// Keep the most recent N messages per session to prevent unbounded memory growth.
const MAX_MESSAGES_PER_SESSION = 500;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private eventHandler: SessionEventHandler | null = null;
  private credentialStore: CredentialStore;
  private containerManager: ContainerManager;

  constructor(credentialStore: CredentialStore, containerManager: ContainerManager) {
    this.credentialStore = credentialStore;
    this.containerManager = containerManager;

    // Push refreshed tokens to all active session agents
    this.credentialStore.onTokenRefreshed((newToken: string) => {
      this.broadcastTokenUpdate(newToken);
    });
  }

  onEvent(handler: SessionEventHandler): void {
    this.eventHandler = handler;
  }

  private emit(sessionId: string, event: string, data: unknown): void {
    this.eventHandler?.(sessionId, event, data);
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info);
  }

  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  getMessages(sessionId: string): SessionMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  async createSession(name: string, repoUrl: string, branch: string, dockerAccess = false): Promise<SessionInfo> {
    const id = uuid();
    const sessionToken = v4();

    const info: SessionInfo = {
      id,
      name,
      repoUrl,
      branch,
      dockerAccess,
      status: 'starting',
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
      lastMessagePreview: null,
      totalCostUsd: 0,
      permissionMode: 'normal',
      model: null,
      notificationsEnabled: false,
      contextUsage: null,
    };

    const session: ManagedSession = {
      info,
      messages: [],
      containerId: null,
      agentWs: null,
      sessionToken,
      pendingApproval: null,
      pendingQuestion: null,
    };

    this.sessions.set(id, session);
    console.log(`[session:${id}] created "${name}", repo: ${repoUrl}@${branch}`);
    this.emit(id, 'session_update', info);

    // Add a system message about setup
    this.addMessage(session, {
      id: uuid(),
      sessionId: id,
      type: 'system',
      content: `Setting up session container for ${repoUrl} (branch: ${branch})...`,
      timestamp: new Date().toISOString(),
    });

    // Spin up the container asynchronously
    this.startContainer(session).catch((err) => {
      console.error(`[session:${id}] Container startup failed:`, err);
      this.updateStatus(session, 'error');
      this.addMessage(session, {
        id: uuid(),
        sessionId: id,
        type: 'error',
        content: `Container startup failed: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
    });

    return info;
  }

  // Push a refreshed token to all active session agents.
  private broadcastTokenUpdate(newToken: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.agentWs && session.info.status !== 'terminated' && session.info.status !== 'error') {
        console.log(`[session:${sessionId}] Pushing refreshed token to agent`);
        this.sendToAgent(sessionId, { type: 'token_update', token: newToken });
      }
    }
  }

  private async startContainer(session: ManagedSession): Promise<void> {
    const claudeDir = this.credentialStore.getSelectedClaudeDir();
    const oauthToken = (await this.credentialStore.ensureFreshToken()) ?? undefined;

    const containerConfig: SessionContainerConfig = {
      sessionId: session.info.id,
      sessionToken: session.sessionToken,
      repoUrl: session.info.repoUrl,
      branch: session.info.branch,
      githubToken: process.env.GITHUB_TOKEN,
      gitUserName: process.env.GIT_USER_NAME,
      gitUserEmail: process.env.GIT_USER_EMAIL,
      claudeDir: claudeDir || '',
      oauthToken,
      permissionMode: session.info.permissionMode,
      dockerAccess: session.info.dockerAccess,
    };

    const containerId = await this.containerManager.createSessionContainer(containerConfig);
    session.containerId = containerId;
  }

  // --- Agent authentication & connection management ---

  authenticateAgent(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.sessionToken === token;
  }

  registerAgentConnection(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.agentWs = ws;
    console.log(`[session:${sessionId}] Agent WebSocket registered`);
  }

  unregisterAgentConnection(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.agentWs = null;
    console.log(`[session:${sessionId}] Agent WebSocket unregistered`);

    // If the session wasn't explicitly terminated, mark as error
    if (session.info.status !== 'terminated' && session.info.status !== 'error') {
      this.updateStatus(session, 'error');
      this.addMessage(session, {
        id: uuid(),
        sessionId,
        type: 'error',
        content: 'Session agent disconnected unexpectedly',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // --- Handle messages from the session agent ---

  handleAgentMessage(sessionId: string, message: AgentToMasterMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (message.type) {
      case 'ready':
        console.log(`[session:${sessionId}] Agent ready`);
        this.updateStatus(session, 'idle');
        this.addMessage(session, {
          id: uuid(),
          sessionId,
          type: 'system',
          content: 'Session container ready',
          timestamp: new Date().toISOString(),
        });
        break;

      case 'setup_progress':
        this.addMessage(session, {
          id: uuid(),
          sessionId,
          type: 'system',
          content: message.message,
          timestamp: new Date().toISOString(),
        });
        break;

      case 'sdk_message':
        // Skip user messages — master already adds them in sendMessage()
        if (message.message.type === 'user') break;
        // Fill in the sessionId (agent sends empty)
        const msg = { ...message.message, sessionId };
        this.addMessage(session, msg);
        break;

      case 'stream':
        this.emit(sessionId, 'stream', {
          messageId: message.messageId,
          token: message.token,
        });
        break;

      case 'approval_request':
        session.pendingApproval = message.approval;
        this.updateStatus(session, 'awaiting_approval');
        this.emit(sessionId, 'approval_request', message.approval);
        break;

      case 'question':
        session.pendingQuestion = message.question;
        this.updateStatus(session, 'awaiting_answer');
        this.emit(sessionId, 'question', message.question);
        break;

      case 'result':
        session.pendingApproval = null;
        session.pendingQuestion = null;
        this.updateStatus(session, 'idle');
        this.emit(sessionId, 'result', {
          result: message.result,
          costUsd: message.costUsd,
          isError: message.isError,
          contextUsage: message.contextUsage,
        });
        break;

      case 'status_update':
        this.updateStatus(session, message.status);
        break;

      case 'session_info_update':
        if (message.model !== undefined) session.info.model = message.model;
        if (message.permissionMode !== undefined) session.info.permissionMode = message.permissionMode as PermissionMode;
        if (message.totalCostUsd !== undefined) session.info.totalCostUsd = message.totalCostUsd;
        if (message.contextUsage !== undefined) session.info.contextUsage = message.contextUsage;
        this.emit(sessionId, 'session_update', session.info);
        break;

      case 'models_list':
        this.emit(sessionId, 'models_list', message.models);
        break;

      case 'error':
        console.error(`[session:${sessionId}] Agent error: ${message.message}`);
        this.addMessage(session, {
          id: uuid(),
          sessionId,
          type: 'error',
          content: message.message,
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  // --- Proxy commands from client → agent ---

  private sendToAgent(sessionId: string, message: MasterToAgentMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session?.agentWs) {
      console.warn(`[session:${sessionId}] Cannot send to agent: no WebSocket (message type: ${message.type})`);
      return;
    }
    session.agentWs.send(JSON.stringify(message));
  }

  sendMessage(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Store user message locally
    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'user',
      content,
      timestamp: new Date().toISOString(),
    });

    this.sendToAgent(sessionId, { type: 'user_message', content });
  }

  approveToolUse(sessionId: string, approvalId: string, allow: boolean, message?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pendingApproval = null;
    this.sendToAgent(sessionId, { type: 'approval_response', approvalId, allow, message });
  }

  answerQuestion(sessionId: string, questionId: string, answers: Record<string, string>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pendingQuestion = null;
    this.sendToAgent(sessionId, { type: 'question_response', questionId, answers });
  }

  async interruptSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { status } = session.info;
    if (status === 'idle' || status === 'terminated' || status === 'error') return;

    console.log(`[session:${sessionId}] interrupting (was ${status})`);
    session.pendingApproval = null;
    session.pendingQuestion = null;

    this.sendToAgent(sessionId, { type: 'interrupt' });
  }

  async getSupportedModels(sessionId: string): Promise<void> {
    this.sendToAgent(sessionId, { type: 'get_models' });
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    this.sendToAgent(sessionId, { type: 'set_model', model });
  }

  updateSessionSettings(sessionId: string, settings: SessionSettingsUpdate): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (settings.name !== undefined) {
      session.info.name = settings.name;
    }
    if (settings.permissionMode !== undefined) {
      session.info.permissionMode = settings.permissionMode;
    }
    if (settings.notificationsEnabled !== undefined) {
      session.info.notificationsEnabled = settings.notificationsEnabled;
    }

    this.emit(sessionId, 'session_update', session.info);

    // Forward settings to agent
    this.sendToAgent(sessionId, {
      type: 'update_settings',
      permissionMode: settings.permissionMode,
      name: settings.name,
      notificationsEnabled: settings.notificationsEnabled,
    });
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Mark terminated before stopping so the WS disconnect handler doesn't flag as error
    this.updateStatus(session, 'terminated');
    session.agentWs = null;
    await this.containerManager.stopAndRemove(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Mark terminated before stopping so the WS disconnect handler doesn't flag as error
    session.info.status = 'terminated';
    await this.containerManager.stopAndRemove(sessionId);
    this.sessions.delete(sessionId);
  }

  private updateStatus(session: ManagedSession, status: SessionStatus): void {
    session.info.status = status;
    this.emit(session.info.id, 'session_update', session.info);
  }

  private addMessage(session: ManagedSession, message: SessionMessage): void {
    session.messages.push(message);

    // Trim oldest messages when the array exceeds the cap
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }

    session.info.lastMessageAt = message.timestamp;
    session.info.lastMessagePreview =
      message.content.length > 100
        ? message.content.slice(0, 100) + '...'
        : message.content;
    this.emit(session.info.id, 'messages', [message]);
  }
}
