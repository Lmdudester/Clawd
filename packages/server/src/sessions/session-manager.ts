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
  managerState: ManagerState | null;
}

type SessionEventHandler = (sessionId: string, event: string, data: unknown) => void;

// Keep the most recent N messages per session to prevent unbounded memory growth.
const MAX_MESSAGES_PER_SESSION = 500;

// How long to keep terminated sessions in memory before evicting them (5 minutes).
const TERMINATED_SESSION_TTL_MS = 5 * 60 * 1000;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
      managerState,
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
        // Auto-continue for manager sessions
        if (session.info.isManager) {
          this.scheduleManagerContinue(sessionId);
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

  sendMessage(sessionId: string, content: string): void {
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

    // Clear manager auto-continue timer on interrupt
    if (session.managerContinueTimer) {
      clearTimeout(session.managerContinueTimer);
      session.managerContinueTimer = null;
    }

    this.sendToAgent(sessionId, { type: 'interrupt' });
  }

  async pauseManager(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.info.isManager || !session.managerState) return;

    session.managerState.paused = true;
    session.info.managerState = session.managerState;

    // Clear any pending auto-continue timer
    if (session.managerContinueTimer) {
      clearTimeout(session.managerContinueTimer);
      session.managerContinueTimer = null;
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
      content: 'Manager session paused. Auto-continue is suspended.',
      timestamp: new Date().toISOString(),
    });

    console.log(`[session:${sessionId}] Manager paused`);
  }

  resumeManager(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.info.isManager || !session.managerState) return;
    if (!session.managerState.paused) return;

    session.managerState.paused = false;
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

    // If idle, restart the auto-continue loop immediately
    if (session.info.status === 'idle') {
      this.scheduleManagerContinue(sessionId);
    }
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

    // If cleanup is already in-flight, wait for it instead of starting another
    if (session.cleanupPromise) {
      await session.cleanupPromise;
      return;
    }

    const cleanup = async () => {
      // Clear auto-continue timer
      if (session.managerContinueTimer) {
        clearTimeout(session.managerContinueTimer);
        session.managerContinueTimer = null;
      }

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

    const cleanup = async () => {
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

  // Auto-continue logic for manager sessions.
  // When a manager goes idle, ping it after a short delay to keep the loop going.
  private scheduleManagerContinue(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.info.isManager) return;

    // Do not schedule if paused
    if (session.managerState?.paused) return;

    // Clear any existing timer
    if (session.managerContinueTimer) {
      clearTimeout(session.managerContinueTimer);
      session.managerContinueTimer = null;
    }

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

      console.log(`[session:${sessionId}] Auto-continuing manager session`);
      this.sendMessage(sessionId, `Continue your manager loop. Check on child sessions and proceed with the next step.${focusReminder}`);
    }, 3000);
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
            { label: 'Skip exploration', description: 'Skip exploration and go straight to fixing existing GitHub issues' },
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

    const focus: ManagerFocus =
      focusAnswer.toLowerCase().includes('bug') ? 'bugs' :
      focusAnswer.toLowerCase().includes('enhancement') ? 'enhancements' :
      'both';

    const skipExploration = explorationAnswer.toLowerCase().includes('skip');

    const preferences: ManagerPreferences = { focus, skipExploration };

    session.managerState.preferences = preferences;
    session.info.managerState = session.managerState;
    this.emit(sessionId, 'session_update', session.info);

    this.updateStatus(session, 'idle');

    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'system',
      content: `Manager configured: focus=${focus}, exploration=${skipExploration ? 'skip' : 'enabled'}`,
      timestamp: new Date().toISOString(),
    });

    const initialMessage = this.buildManagerInitialMessage(preferences);
    setTimeout(() => {
      this.sendMessage(sessionId, initialMessage);
    }, 500);
  }

  private buildManagerInitialMessage(preferences: ManagerPreferences): string {
    const { focus, skipExploration } = preferences;

    const focusDescription =
      focus === 'bugs' ? 'bugs and code quality issues' :
      focus === 'enhancements' ? 'enhancements and improvements' :
      'bugs and enhancements';

    if (skipExploration) {
      return `Begin your independent manager loop. Skip exploration — go directly to Step 2 (Fix). Look at existing GitHub issues with \`gh issue list\` and focus on ${focusDescription}. Triage the issues, then create fix sessions for each group.`;
    }

    return `Begin your independent manager loop. Start with Step 1: create exploration sessions to find ${focusDescription} in this repository. Track all findings as GitHub issues.`;
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
