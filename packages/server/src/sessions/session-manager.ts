import { v4 as uuid } from 'uuid';
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
  ManagerState,
  ManagerStep,
  ManagerFocus,
  ManagerPreferences,
} from '@clawd/shared';
import { config } from '../config.js';
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
  cleanupPromise: Promise<void> | null;
  managerApiToken: string | null;
  managerContinueTimer: ReturnType<typeof setTimeout> | null;
  managerResumeTimer: ReturnType<typeof setTimeout> | null;
  managerEventBatchTimer: ReturnType<typeof setTimeout> | null;
  managerConsecutiveFastTurns: number;
  managerLastTurnSentAt: number;
  managerState: ManagerState | null;
  pendingManagerEvents: string[];
}

type SessionEventHandler = (sessionId: string, event: string, data: unknown) => void;

// Keep the most recent N messages per session to prevent unbounded memory growth.
const MAX_MESSAGES_PER_SESSION = 500;

// How long to keep terminated sessions in memory before evicting them (5 minutes).
const TERMINATED_SESSION_TTL_MS = 5 * 60 * 1000;

// How long a managed child can go without agent messages before considered stale.
const CHILD_ACTIVITY_TIMEOUT_MS = 30_000;

// Minimum batch window before delivering queued manager events.
const MANAGER_EVENT_BATCH_DELAY_MS = 2_000;

// A manager turn completing faster than this (with low output) is considered "fast" / zero-progress.
const MANAGER_FAST_TURN_THRESHOLD_MS = 3_000;

// Maximum backoff delay for consecutive fast turns.
const MANAGER_MAX_BACKOFF_DELAY_MS = 60_000;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private childActivityTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  async createSession(name: string, repoUrl: string, branch: string, dockerAccess = false, managerMode = false, createdBy = 'unknown'): Promise<SessionInfo> {
    // Enforce maximum session limit to prevent unbounded container creation
    if (config.maxSessions > 0) {
      const activeSessions = Array.from(this.sessions.values()).filter(
        (s) => s.info.status !== 'terminated' && s.info.status !== 'error',
      );
      if (activeSessions.length >= config.maxSessions) {
        throw new Error(`Session limit reached (max ${config.maxSessions}). Terminate existing sessions before creating new ones.`);
      }
    }

    const id = uuid();
    const sessionToken = uuid();

    const managerState: ManagerState | null = managerMode
      ? { targetBranch: branch, currentStep: 'idle', childSessionIds: [] }
      : null;

    const info: SessionInfo = {
      id,
      name,
      repoUrl,
      branch,
      dockerAccess,
      status: 'starting',
      createdAt: new Date().toISOString(),
      createdBy,
      lastMessageAt: null,
      lastMessagePreview: null,
      totalCostUsd: 0,
      permissionMode: managerMode ? 'dangerous' : 'normal',
      model: null,
      notificationsEnabled: false,
      contextUsage: null,
      isManager: managerMode || undefined,
      managerState: managerState || undefined,
    };

    const session: ManagedSession = {
      info,
      messages: [],
      containerId: null,
      agentWs: null,
      sessionToken,
      pendingApproval: null,
      pendingQuestion: null,
      cleanupPromise: null,
      managerApiToken: managerMode ? uuid() : null,
      managerContinueTimer: null,
      managerResumeTimer: null,
      managerEventBatchTimer: null,
      managerConsecutiveFastTurns: 0,
      managerLastTurnSentAt: 0,
      managerState,
      pendingManagerEvents: [],
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
      this.scheduleEviction(id);
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

  // Validate a manager API token — returns true if any active manager session has this token
  validateManagerToken(token: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.managerApiToken && session.managerApiToken === token && session.info.status !== 'terminated') {
        return true;
      }
    }
    return false;
  }

  // Find the manager session that owns a given API token
  findManagerByToken(token: string): string | null {
    for (const session of this.sessions.values()) {
      if (session.managerApiToken && session.managerApiToken === token && session.info.status !== 'terminated') {
        return session.info.id;
      }
    }
    return null;
  }

  // Remove a child session from its parent manager's tracking
  private untrackChildSession(childId: string): void {
    this.clearChildActivityTimer(childId);

    const child = this.sessions.get(childId);
    const managerId = child?.info.managedBy;
    if (!managerId) return;

    const manager = this.sessions.get(managerId);
    if (!manager?.managerState) return;

    const idx = manager.managerState.childSessionIds.indexOf(childId);
    if (idx !== -1) {
      manager.managerState.childSessionIds.splice(idx, 1);
      manager.info.managerState = manager.managerState;
      this.emit(managerId, 'session_update', manager.info);
    }
  }

  // Link a child session to its parent manager
  trackChildSession(managerId: string, childId: string): void {
    const session = this.sessions.get(managerId);
    if (!session?.managerState) return;
    session.managerState.childSessionIds.push(childId);
    session.info.managerState = session.managerState;
    this.emit(managerId, 'session_update', session.info);

    // Set reverse link on the child so the UI can show a "Managed" badge
    const child = this.sessions.get(childId);
    if (child) {
      child.info.managedBy = managerId;
      this.emit(childId, 'session_update', child.info);
    }
  }

  // Update the current step for a manager session
  updateManagerStep(sessionId: string, step: ManagerStep): void {
    const session = this.sessions.get(sessionId);
    if (!session?.managerState) return;
    session.managerState.currentStep = step;
    session.info.managerState = session.managerState;
    this.emit(sessionId, 'session_update', session.info);
  }

  private async startContainer(session: ManagedSession): Promise<void> {
    const claudeDir = this.credentialStore.getSelectedClaudeDir();
    let oauthToken = (await this.credentialStore.ensureFreshToken()) ?? undefined;

    // If token is unavailable, wait briefly and retry once — covers transient
    // refresh failures and cooldown windows that are common when multiple
    // child sessions start concurrently.
    if (!oauthToken) {
      console.warn(`[session:${session.info.id}] OAuth token unavailable, retrying after delay...`);
      await new Promise((r) => setTimeout(r, 5000));
      oauthToken = (await this.credentialStore.ensureFreshToken()) ?? undefined;
      if (!oauthToken) {
        console.warn(`[session:${session.info.id}] OAuth token still unavailable — container will start without it`);
      }
    }

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
      managerMode: !!session.info.isManager,
      managerApiToken: session.managerApiToken ?? undefined,
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
    if (session.agentWs && session.agentWs !== ws) {
      console.warn(`[session:${sessionId}] Replacing existing agent WebSocket — closing old connection`);
      session.agentWs.close();
    }
    session.agentWs = ws;
    console.log(`[session:${sessionId}] Agent WebSocket registered`);

    // Push current OAuth token to newly connected agent — covers the case
    // where the token was unavailable or stale at container creation time
    // but has since been refreshed.
    const currentToken = this.credentialStore.getAccessToken();
    if (currentToken) {
      this.sendToAgent(sessionId, { type: 'token_update', token: currentToken });
    }
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
      this.scheduleEviction(sessionId);
    }
  }

  // --- Handle messages from the session agent ---

  handleAgentMessage(sessionId: string, message: AgentToMasterMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Reset activity timer for managed children
    if (session.info.managedBy) {
      this.resetChildActivityTimer(sessionId);
    }

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
        // Show onboarding questions for manager sessions instead of auto-starting
        if (session.info.isManager) {
          this.showManagerOnboarding(sessionId);
        }
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
        // Auto-approve for manager sessions
        if (session.info.isManager) {
          console.log(`[session:${sessionId}] Manager auto-approving: ${message.approval.toolName}`);
          session.pendingApproval = null;
          this.sendToAgent(sessionId, { type: 'approval_response', approvalId: message.approval.id, allow: true });
          break;
        }
        session.pendingApproval = message.approval;
        this.updateStatus(session, 'awaiting_approval');
        this.emit(sessionId, 'approval_request', message.approval);

        // Forward approval request to parent manager if this is a managed child
        if (session.info.managedBy) {
          this.forwardApprovalToManager(sessionId, session, message.approval);
        }
        break;

      case 'question':
        // Auto-answer for manager sessions — don't block
        if (session.info.isManager) {
          console.log(`[session:${sessionId}] Manager auto-answering question`);
          session.pendingQuestion = null;
          this.sendToAgent(sessionId, { type: 'question_response', questionId: message.question.id, answers: {} });
          break;
        }
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
        // For manager sessions: track turn speed and deliver queued events with backoff
        if (session.info.isManager) {
          const turnDuration = session.managerLastTurnSentAt > 0
            ? Date.now() - session.managerLastTurnSentAt
            : Infinity;
          const outputTokens = message.contextUsage?.lastTurnOutputTokens ?? Infinity;
          const isFastTurn = turnDuration < MANAGER_FAST_TURN_THRESHOLD_MS && outputTokens < 50;

          if (isFastTurn) {
            session.managerConsecutiveFastTurns++;
            console.log(`[session:${sessionId}] Manager fast turn detected (${turnDuration}ms, ${outputTokens} tokens, streak=${session.managerConsecutiveFastTurns})`);
          } else {
            session.managerConsecutiveFastTurns = 0;
          }

          this.scheduleManagerEventDelivery(sessionId);
        }
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
    try {
      session.agentWs.send(JSON.stringify(message));
    } catch (err) {
      console.error(`[session:${sessionId}] Failed to send to agent (message type: ${message.type}):`, err);
      this.updateStatus(session, 'error');
      this.addMessage(session, {
        id: uuid(),
        sessionId,
        type: 'error',
        content: `Failed to send message to session agent: ${(err as Error).message || 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  sendMessage(sessionId: string, content: string, source?: SessionMessage['source']): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { status } = session.info;
    if (status === 'terminated' || status === 'error') {
      console.warn(`[session:${sessionId}] Cannot send message: session is ${status}`);
      return;
    }

    // Store user message locally
    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'user',
      content,
      timestamp: new Date().toISOString(),
      ...(source && { source }),
    });

    this.sendToAgent(sessionId, { type: 'user_message', content });
  }

  approveToolUse(sessionId: string, approvalId: string, allow: boolean, message?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { status } = session.info;
    if (status === 'terminated' || status === 'error') {
      console.warn(`[session:${sessionId}] Cannot approve tool: session is ${status}`);
      return;
    }

    session.pendingApproval = null;
    this.sendToAgent(sessionId, { type: 'approval_response', approvalId, allow, message });
  }

  answerQuestion(sessionId: string, questionId: string, answers: Record<string, string>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { status } = session.info;
    if (status === 'terminated' || status === 'error') {
      console.warn(`[session:${sessionId}] Cannot answer question: session is ${status}`);
      return;
    }

    // Intercept server-generated onboarding questions for manager sessions
    if (session.pendingQuestion?.id === questionId && session.info.isManager && !session.managerState?.preferences) {
      session.pendingQuestion = null;
      this.handleManagerOnboardingAnswer(sessionId, answers);
      return;
    }

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

    // Clear manager timers on interrupt
    if (session.managerContinueTimer) {
      clearTimeout(session.managerContinueTimer);
      session.managerContinueTimer = null;
    }
    if (session.managerEventBatchTimer) {
      clearTimeout(session.managerEventBatchTimer);
      session.managerEventBatchTimer = null;
    }
    session.managerConsecutiveFastTurns = 0;

    this.sendToAgent(sessionId, { type: 'interrupt' });
  }

  async pauseManager(sessionId: string, resumeAt?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.info.isManager || !session.managerState) return;

    session.managerState.paused = true;

    // Clear any existing resume timer
    if (session.managerResumeTimer) {
      clearTimeout(session.managerResumeTimer);
      session.managerResumeTimer = null;
    }
    session.managerState.resumeAt = undefined;

    // Set up timed auto-resume if requested
    let resumeMessage = 'Manager session paused. Auto-continue is suspended.';
    if (resumeAt) {
      const resumeTime = new Date(resumeAt).getTime();
      const now = Date.now();
      const delay = resumeTime - now;
      const maxDelay = 24 * 60 * 60 * 1000; // 24 hours

      if (delay > 0 && delay <= maxDelay) {
        session.managerState.resumeAt = resumeAt;
        session.managerResumeTimer = setTimeout(() => {
          session.managerResumeTimer = null;
          this.resumeManager(sessionId);
        }, delay);
        resumeMessage = `Manager session paused. Will auto-resume at ${resumeAt}.`;
      }
    }

    session.info.managerState = session.managerState;

    // Clear any pending auto-continue and batch timers
    if (session.managerContinueTimer) {
      clearTimeout(session.managerContinueTimer);
      session.managerContinueTimer = null;
    }
    if (session.managerEventBatchTimer) {
      clearTimeout(session.managerEventBatchTimer);
      session.managerEventBatchTimer = null;
    }

    // If currently running, interrupt the current turn
    const { status } = session.info;
    if (status === 'running' || status === 'awaiting_approval' || status === 'awaiting_answer') {
      session.pendingApproval = null;
      session.pendingQuestion = null;
      this.sendToAgent(sessionId, { type: 'interrupt' });
    }

    this.emit(sessionId, 'session_update', session.info);

    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'system',
      content: resumeMessage,
      timestamp: new Date().toISOString(),
    });

    console.log(`[session:${sessionId}] Manager paused${session.managerState.resumeAt ? ` (auto-resume at ${session.managerState.resumeAt})` : ''}`);
  }

  resumeManager(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.info.isManager || !session.managerState) return;
    if (!session.managerState.paused) return;

    // Clear any pending auto-resume timer
    if (session.managerResumeTimer) {
      clearTimeout(session.managerResumeTimer);
      session.managerResumeTimer = null;
    }

    session.managerState.paused = false;
    session.managerState.resumeAt = undefined;
    session.info.managerState = session.managerState;

    this.emit(sessionId, 'session_update', session.info);

    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'system',
      content: 'Manager session resumed. Auto-continue is active.',
      timestamp: new Date().toISOString(),
    });

    console.log(`[session:${sessionId}] Manager resumed`);

    // If idle, deliver queued events or fall back to auto-continue
    if (session.info.status === 'idle') {
      session.managerConsecutiveFastTurns = 0; // reset on explicit resume
      this.scheduleManagerEventDelivery(sessionId);
    }
  }

  async getSupportedModels(sessionId: string): Promise<void> {
    this.sendToAgent(sessionId, { type: 'get_models' });
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    this.sendToAgent(sessionId, { type: 'set_model', model });
  }

  private static readonly VALID_PERMISSION_MODES = new Set(['normal', 'auto_edits', 'dangerous', 'plan']);

  updateSessionSettings(sessionId: string, settings: SessionSettingsUpdate): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Validate all inputs before applying any changes to avoid partial state updates
    if (settings.permissionMode !== undefined) {
      if (!SessionManager.VALID_PERMISSION_MODES.has(settings.permissionMode)) {
        console.warn(`[session:${sessionId}] Invalid permissionMode: ${settings.permissionMode}`);
        return;
      }
    }

    if (settings.name !== undefined) {
      const cleaned = settings.name.replace(/[\x00-\x1F\x7F]/g, '').trim();
      if (!cleaned || cleaned.length > 100) {
        console.warn(`[session:${sessionId}] Invalid session name update rejected`);
      } else {
        session.info.name = cleaned;
      }
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
      name: session.info.name,
      notificationsEnabled: settings.notificationsEnabled,
    });
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // If cleanup is already in-flight, wait for it instead of starting another
    if (session.cleanupPromise) {
      await session.cleanupPromise;
      return;
    }

    // Remove from parent manager's tracking before cleanup
    this.untrackChildSession(sessionId);

    const cleanup = async () => {
      // Clear auto-continue timer
      if (session.managerContinueTimer) {
        clearTimeout(session.managerContinueTimer);
        session.managerContinueTimer = null;
      }

      // Clear event batch timer
      if (session.managerEventBatchTimer) {
        clearTimeout(session.managerEventBatchTimer);
        session.managerEventBatchTimer = null;
      }

      // Clear auto-resume timer
      if (session.managerResumeTimer) {
        clearTimeout(session.managerResumeTimer);
        session.managerResumeTimer = null;
      }

      // Clear child activity timer
      this.clearChildActivityTimer(sessionId);

      // Mark terminated before stopping so the WS disconnect handler doesn't flag as error
      this.updateStatus(session, 'terminated');
      // Explicitly close the agent WebSocket before nulling it so the close
      // event fires while the session still has the correct terminated status,
      // rather than relying on container teardown timing.
      session.agentWs?.close();
      session.agentWs = null;
      await this.containerManager.stopAndRemove(sessionId);
    };

    session.cleanupPromise = cleanup();
    await session.cleanupPromise;

    // Schedule eviction from memory so terminated sessions don't linger forever
    this.scheduleEviction(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Cancel any pending eviction timer — we're removing immediately
    this.cancelEviction(sessionId);

    const session = this.sessions.get(sessionId);
    if (!session) return;

    // If cleanup is already in-flight, wait for it to finish first
    if (session.cleanupPromise) {
      await session.cleanupPromise;
      // Session may have been deleted by a concurrent deleteSession call
      if (!this.sessions.has(sessionId)) return;
    }

    // Remove from parent manager's tracking before cleanup
    this.untrackChildSession(sessionId);

    const cleanup = async () => {
      // Clear auto-continue timer
      if (session.managerContinueTimer) {
        clearTimeout(session.managerContinueTimer);
        session.managerContinueTimer = null;
      }

      // Clear auto-resume timer
      if (session.managerResumeTimer) {
        clearTimeout(session.managerResumeTimer);
        session.managerResumeTimer = null;
      }

      // Mark terminated before stopping so the WS disconnect handler doesn't flag as error
      this.updateStatus(session, 'terminated');
      // Explicitly close the agent WebSocket before nulling it so the close
      // handler in internal-handler.ts sees the session as terminated.
      session.agentWs?.close();
      session.agentWs = null;
      await this.containerManager.stopAndRemove(sessionId);
      this.sessions.delete(sessionId);
    };

    session.cleanupPromise = cleanup();
    await session.cleanupPromise;
  }

  private scheduleEviction(sessionId: string): void {
    this.cancelEviction(sessionId);
    const timer = setTimeout(() => {
      this.evictionTimers.delete(sessionId);
      if (this.sessions.has(sessionId)) {
        console.log(`[session:${sessionId}] Evicting terminated session from memory`);
        this.sessions.delete(sessionId);
      }
    }, TERMINATED_SESSION_TTL_MS);
    this.evictionTimers.set(sessionId, timer);
  }

  private cancelEviction(sessionId: string): void {
    const timer = this.evictionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(sessionId);
    }
  }

  // Compute delivery delay with exponential backoff based on consecutive fast turns.
  private getManagerDeliveryDelay(session: ManagedSession): number {
    const n = session.managerConsecutiveFastTurns;
    if (n <= 0) return MANAGER_EVENT_BATCH_DELAY_MS;
    const backoff = MANAGER_EVENT_BATCH_DELAY_MS * Math.pow(2, n - 1);
    return Math.min(backoff, MANAGER_MAX_BACKOFF_DELAY_MS);
  }

  // Unified event delivery: batches pending events and delivers them after a debounced delay.
  private scheduleManagerEventDelivery(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.info.isManager || !session.managerState) return;

    // Do not deliver if paused
    if (session.managerState.paused) return;

    // Debounce: if a batch timer is already running, new events are absorbed into the existing window
    if (session.managerEventBatchTimer) return;

    const delay = Math.max(MANAGER_EVENT_BATCH_DELAY_MS, this.getManagerDeliveryDelay(session));

    if (session.managerConsecutiveFastTurns > 0) {
      console.log(`[session:${sessionId}] Manager backoff: ${delay}ms (${session.managerConsecutiveFastTurns} consecutive fast turns)`);
    }

    session.managerEventBatchTimer = setTimeout(() => {
      session.managerEventBatchTimer = null;
      const s = this.sessions.get(sessionId);
      if (!s || s.info.status !== 'idle' || !s.info.isManager) return;
      if (s.managerState?.paused) return;

      if (s.pendingManagerEvents.length > 0) {
        const events = s.pendingManagerEvents.splice(0);
        const combined = events.join('\n\n---\n\n');

        // Cancel any existing auto-continue timer since we're delivering events directly
        if (s.managerContinueTimer) {
          clearTimeout(s.managerContinueTimer);
          s.managerContinueTimer = null;
        }

        s.managerLastTurnSentAt = Date.now();
        this.sendMessage(sessionId, combined, 'child_event');
      } else {
        // No events accumulated — fall through to auto-continue
        this.scheduleManagerContinue(sessionId);
      }
    }, delay);
  }

  // Auto-continue logic for manager sessions.
  // When a manager goes idle, ping it after a short delay to keep the loop going.
  private scheduleManagerContinue(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.info.isManager || !session.managerState) return;

    // Do not schedule if paused
    if (session.managerState.paused) return;

    // Clear any existing timer
    if (session.managerContinueTimer) {
      clearTimeout(session.managerContinueTimer);
      session.managerContinueTimer = null;
    }

    // If any live children exist, wait for push events instead of auto-continuing.
    // untrackChildSession() removes terminated children, so any remaining entries are live.
    const childIds = session.managerState.childSessionIds;
    if (childIds.length > 0) return;

    // Apply backoff to auto-continue delay too
    const delay = Math.max(3000, this.getManagerDeliveryDelay(session));

    // No live children (setup phase or all done) — auto-continue
    session.managerContinueTimer = setTimeout(() => {
      session.managerContinueTimer = null;
      const s = this.sessions.get(sessionId);
      if (!s || s.info.status !== 'idle' || !s.info.isManager) return;

      // Double-check paused state inside the timer callback
      if (s.managerState?.paused) return;

      const prefs = s.managerState?.preferences;
      const focusReminder = prefs
        ? ` Remember: focus on ${prefs.focus === 'bugs' ? 'bugs only' : prefs.focus === 'enhancements' ? 'enhancements only' : 'both bugs and enhancements'}.`
        : '';

      s.managerLastTurnSentAt = Date.now();
      console.log(`[session:${sessionId}] Auto-continuing manager session`);
      this.sendMessage(sessionId, `Continue your manager loop. Check on child sessions and proceed with the next step.${focusReminder}`, 'auto_continue');
    }, delay);
  }

  private showManagerOnboarding(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const questionId = uuid();
    const question: PendingQuestion = {
      id: questionId,
      questions: [
        {
          question: 'What should the manager focus on?',
          header: 'Focus',
          options: [
            { label: 'Bugs', description: 'Find and fix bugs only' },
            { label: 'Enhancements', description: 'Find and implement enhancements only' },
            { label: 'Both', description: 'Find and address both bugs and enhancements' },
          ],
          multiSelect: false,
        },
        {
          question: 'Should the manager explore the codebase first?',
          header: 'Exploration',
          options: [
            { label: 'Explore', description: 'Run exploration sessions to discover issues before fixing' },
            { label: 'Skip exploration', description: 'Skip exploration and go straight to triaging existing GitHub issues' },
          ],
          multiSelect: false,
        },
        {
          question: 'Should the manager wait for your approval on plans?',
          header: 'Plan review',
          options: [
            { label: 'Require approval', description: 'Manager pauses after planning and waits for your feedback on each plan' },
            { label: 'Auto-proceed', description: 'Manager presents plans and continues automatically' },
          ],
          multiSelect: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    session.pendingQuestion = question;
    this.updateStatus(session, 'awaiting_answer');
    this.emit(sessionId, 'question', question);

    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'system',
      content: 'Manager session ready. Please configure preferences before starting.',
      timestamp: new Date().toISOString(),
    });
  }

  private handleManagerOnboardingAnswer(sessionId: string, answers: Record<string, string>): void {
    const session = this.sessions.get(sessionId);
    if (!session?.managerState) return;

    const focusAnswer = answers['What should the manager focus on?'] ?? 'Both';
    const explorationAnswer = answers['Should the manager explore the codebase first?'] ?? 'Explore';
    const planApprovalAnswer = answers['Should the manager wait for your approval on plans?'] ?? 'Auto-proceed';

    const focus: ManagerFocus =
      focusAnswer.toLowerCase().includes('bug') ? 'bugs' :
      focusAnswer.toLowerCase().includes('enhancement') ? 'enhancements' :
      'both';

    const skipExploration = explorationAnswer.toLowerCase().includes('skip');
    const requirePlanApproval = planApprovalAnswer.toLowerCase().includes('require');

    const preferences: ManagerPreferences = { focus, skipExploration, requirePlanApproval };

    session.managerState.preferences = preferences;
    session.info.managerState = session.managerState;
    this.emit(sessionId, 'session_update', session.info);

    this.updateStatus(session, 'idle');

    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'system',
      content: `Manager configured: focus=${focus}, exploration=${skipExploration ? 'skip' : 'enabled'}, plan approval=${requirePlanApproval ? 'required' : 'auto'}`,
      timestamp: new Date().toISOString(),
    });

    const initialMessage = this.buildManagerInitialMessage(preferences);
    setTimeout(() => {
      this.sendMessage(sessionId, initialMessage, 'auto_continue');
    }, 500);
  }

  private buildManagerInitialMessage(preferences: ManagerPreferences): string {
    const { focus, skipExploration, requirePlanApproval } = preferences;

    const focusDescription =
      focus === 'bugs' ? 'bugs and code quality issues' :
      focus === 'enhancements' ? 'enhancements and improvements' :
      'bugs and enhancements';

    const planApprovalNote = requirePlanApproval
      ? ' Plan approval is REQUIRED — after planning and review, STOP and wait for user feedback on each plan before proceeding to fixing.'
      : ' Plan approval is NOT required — after plans pass review, proceed to fixing automatically.';

    if (skipExploration) {
      return `Begin your independent manager loop. Skip exploration — go directly to Step 2 (Triage). Focus on ${focusDescription}.${planApprovalNote}`;
    }

    return `Begin your independent manager loop. Start with Step 1: create exploration sessions to find ${focusDescription} in this repository. Track all findings as GitHub issues.${planApprovalNote}`;
  }

  // --- Push-based manager event delivery ---

  private forwardApprovalToManager(childId: string, child: ManagedSession, approval: PendingApproval): void {
    const managerId = child.info.managedBy;
    if (!managerId) return;
    const manager = this.sessions.get(managerId);
    if (!manager?.info.isManager || manager.managerState?.paused) return;

    // Format tool input — truncate large payloads (Write/Edit file contents)
    const inputStr = JSON.stringify(approval.toolInput, null, 2);
    const truncatedInput = inputStr.length > 1000
      ? inputStr.slice(0, 1000) + '\n...(truncated)'
      : inputStr;

    const reasonBlock = approval.reason
      ? `\nChild's reasoning:\n${approval.reason.slice(0, 500)}\n`
      : '';

    const message = `[CHILD APPROVAL REQUEST]
Session: "${child.info.name}" (ID: ${childId})
Tool: ${approval.toolName}
Input:
${truncatedInput}
${reasonBlock}
Review the tool request and the child's reasoning. Approve if on-track, deny with guidance if off-track.

Approval ID: ${approval.id}`;

    this.deliverOrQueueManagerEvent(managerId, manager, message);
  }

  private notifyManagerOfChildStatus(
    childId: string, child: ManagedSession,
    previousStatus: SessionStatus, newStatus: SessionStatus
  ): void {
    // Clear stale timer on terminal transitions — these generate their own events
    if (newStatus === 'idle' || newStatus === 'error' || newStatus === 'terminated') {
      this.clearChildActivityTimer(childId);
    }

    const managerId = child.info.managedBy;
    if (!managerId) return;
    const manager = this.sessions.get(managerId);
    if (!manager?.info.isManager || manager.managerState?.paused) return;

    let message: string | null = null;

    if (previousStatus === 'starting' && newStatus === 'idle') {
      message = `[CHILD SESSION READY]\nSession: "${child.info.name}" (ID: ${childId})\nThe session is ready. Send it its instructions via POST /api/sessions/${childId}/message.`;
    } else if (previousStatus === 'running' && newStatus === 'idle') {
      const resultSummary = this.getChildResultSummary(childId);
      message = `[CHILD SESSION COMPLETED]\nSession: "${child.info.name}" (ID: ${childId})\nThe session has finished its work.\n\n--- Child Output ---\n${resultSummary}\n--- End Child Output ---\n\nDecide next steps based on the output above.`;
    } else if (newStatus === 'error') {
      message = `[CHILD SESSION ERROR]\nSession: "${child.info.name}" (ID: ${childId})\nThe session encountered an error. Read its messages to investigate.`;
    }

    if (message) this.deliverOrQueueManagerEvent(managerId, manager, message);
  }

  // Extract assistant messages from a child session for inline delivery.
  private getChildResultSummary(childId: string): string {
    const child = this.sessions.get(childId);
    if (!child) return '(session not found)';

    const parts = child.messages
      .filter(m => m.type === 'assistant')
      .map(m => m.content);

    return parts.length > 0 ? parts.join('\n\n') : '(no output captured)';
  }

  private resetChildActivityTimer(childId: string): void {
    this.clearChildActivityTimer(childId);

    const child = this.sessions.get(childId);
    const managerId = child?.info.managedBy;
    if (!managerId) return;

    // Don't start a timer for terminal states — those produce their own events
    const { status } = child.info;
    if (status === 'terminated' || status === 'error') return;

    const timer = setTimeout(() => {
      this.childActivityTimers.delete(childId);

      const c = this.sessions.get(childId);
      const m = managerId ? this.sessions.get(managerId) : undefined;
      if (!c || !m?.info.isManager || m.managerState?.paused) return;

      const message = `[CHILD SESSION STALE]\nSession: "${c.info.name}" (ID: ${childId})\nNo activity from this session for 30 seconds. Check on its progress and determine if it needs help.`;
      this.deliverOrQueueManagerEvent(managerId, m, message);
    }, CHILD_ACTIVITY_TIMEOUT_MS);

    this.childActivityTimers.set(childId, timer);
  }

  private clearChildActivityTimer(childId: string): void {
    const timer = this.childActivityTimers.get(childId);
    if (timer) {
      clearTimeout(timer);
      this.childActivityTimers.delete(childId);
    }
  }

  private deliverOrQueueManagerEvent(managerId: string, manager: ManagedSession, message: string): void {
    manager.pendingManagerEvents.push(message);
    if (manager.info.status === 'idle') {
      this.scheduleManagerEventDelivery(managerId);
    }
  }

  private updateStatus(session: ManagedSession, status: SessionStatus): void {
    const previousStatus = session.info.status;
    session.info.status = status;
    this.emit(session.info.id, 'session_update', session.info);

    // Notify parent manager of significant child status transitions
    if (session.info.managedBy && previousStatus !== status) {
      this.notifyManagerOfChildStatus(session.info.id, session, previousStatus, status);
    }
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
