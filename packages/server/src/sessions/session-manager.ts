import { query, type SDKMessage, type Query } from '@anthropic-ai/claude-agent-sdk';
import { v4 as uuid } from 'uuid';
import { MessageChannel } from './message-channel.js';
import { windowsToContainer, containerToWindows } from '../path-translator.js';
import type {
  SessionInfo,
  SessionMessage,
  SessionStatus,
  PendingApproval,
  PendingQuestion,
  SessionSettingsUpdate,
  PermissionMode,
} from '@clawd/shared';
import type { CredentialStore } from '../settings/credential-store.js';

function toSDKPermissionMode(mode: PermissionMode): 'default' | 'plan' | 'bypassPermissions' {
  switch (mode) {
    case 'plan': return 'plan';
    case 'auto_accept': return 'bypassPermissions';
    default: return 'default';
  }
}

interface ManagedSession {
  info: SessionInfo;
  messages: SessionMessage[];
  channel: MessageChannel;
  abortController: AbortController;
  sdkSessionId: string | null;
  queryStream: Query | null;
  pendingApproval: {
    approval: PendingApproval;
    resolve: (result: { behavior: 'allow' | 'deny'; message?: string }) => void;
  } | null;
  pendingQuestion: {
    question: PendingQuestion;
    resolve: (answers: Record<string, string>) => void;
  } | null;
  hasAssistantMessage: boolean;
}

type SessionEventHandler = (sessionId: string, event: string, data: unknown) => void;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private eventHandler: SessionEventHandler | null = null;
  private credentialStore: CredentialStore;

  constructor(credentialStore: CredentialStore) {
    this.credentialStore = credentialStore;
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

  createSession(name: string, cwd: string): SessionInfo {
    const id = uuid();
    const containerCwd = windowsToContainer(cwd);

    const channel = new MessageChannel();
    const abortController = new AbortController();

    const info: SessionInfo = {
      id,
      name,
      cwd,
      status: 'idle',
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
      lastMessagePreview: null,
      totalCostUsd: 0,
      permissionMode: 'normal',
      model: null,
      notificationsEnabled: false,
    };

    const session: ManagedSession = {
      info,
      messages: [],
      channel,
      abortController,
      sdkSessionId: null,
      queryStream: null,
      pendingApproval: null,
      pendingQuestion: null,
      hasAssistantMessage: false,
    };

    this.sessions.set(id, session);
    console.log(`[session:${id}] created "${name}", cwd: ${containerCwd}`);
    this.startSDKQuery(session, containerCwd).catch((err) => {
      console.error(`[session:${id}] unhandled SDK query error:`, err);
    });
    this.emit(id, 'session_update', info);
    return info;
  }

  private async startSDKQuery(session: ManagedSession, cwd: string): Promise<void> {
    try {
      // Strip env vars that cause the Claude Code child process to crash
      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_OPTIONS;
      delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;
      delete cleanEnv.CLAUDECODE;

      const queryStream = query({
        prompt: session.channel as AsyncIterable<any>,
        options: {
          cwd,
          env: cleanEnv,
          abortController: session.abortController,
          includePartialMessages: true,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          permissionMode: 'default',
          allowDangerouslySkipPermissions: true,
          canUseTool: async (toolName, input) => {
            return this.handleToolApproval(session, toolName, input);
          },
          stderr: (data: string) => {
            console.error(`[session:${session.info.id}] claude stderr: ${data}`);
          },
        },
      });

      session.queryStream = queryStream;

      for await (const message of queryStream) {
        this.handleSDKMessage(session, message);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`[session:${session.info.id}] aborted`);
        return;
      }
      console.error(`[session:${session.info.id}] SDK query error:`, err);
      this.updateStatus(session, 'error');
      this.addMessage(session, {
        id: uuid(),
        sessionId: session.info.id,
        type: 'error',
        content: err.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleToolApproval(
    session: ManagedSession,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    // Handle AskUserQuestion specially
    if (toolName === 'AskUserQuestion') {
      return this.handleAskUserQuestion(session, input);
    }

    // ExitPlanMode — show approval dialog, switch to normal only if approved
    if (toolName === 'ExitPlanMode' && session.info.permissionMode === 'plan') {
      const approvalId = uuid();
      const approval: PendingApproval = {
        id: approvalId,
        toolName,
        toolInput: input,
        timestamp: new Date().toISOString(),
      };

      this.updateStatus(session, 'awaiting_approval');
      this.emit(session.info.id, 'approval_request', approval);

      const result = await Promise.race([
        new Promise<{ behavior: 'allow' | 'deny'; message?: string }>((resolve) => {
          session.pendingApproval = { approval, resolve };
        }),
        new Promise<{ behavior: 'deny'; message: string }>((resolve) =>
          setTimeout(() => resolve({ behavior: 'deny', message: 'Approval timed out (5 min)' }), 5 * 60 * 1000)
        ),
      ]);

      session.pendingApproval = null;
      this.updateStatus(session, 'running');

      if (result.behavior === 'allow') {
        session.info.permissionMode = 'normal';
        session.queryStream?.setPermissionMode('default');
        this.emit(session.info.id, 'session_update', session.info);
        console.log(`[session:${session.info.id}] exited plan mode → normal`);
        return { behavior: 'allow', updatedInput: input };
      }

      console.log(`[session:${session.info.id}] plan exit denied — staying in plan mode`);
      return { behavior: 'deny', message: result.message || 'Plan not approved' };
    }

    // Show approval dialog
    const approvalId = uuid();
    const approval: PendingApproval = {
      id: approvalId,
      toolName,
      toolInput: input,
      timestamp: new Date().toISOString(),
    };

    this.updateStatus(session, 'awaiting_approval');
    this.emit(session.info.id, 'approval_request', approval);

    // Wait for user response with 5 minute timeout
    const result = await Promise.race([
      new Promise<{ behavior: 'allow' | 'deny'; message?: string }>((resolve) => {
        session.pendingApproval = { approval, resolve };
      }),
      new Promise<{ behavior: 'deny'; message: string }>((resolve) =>
        setTimeout(() => {
          console.warn(`[session:${session.info.id}] tool approval timed out for ${toolName}`);
          resolve({ behavior: 'deny', message: 'Approval timed out (5 min)' });
        }, 5 * 60 * 1000)
      ),
    ]);

    session.pendingApproval = null;
    this.updateStatus(session, 'running');

    if (result.behavior === 'allow') {
      console.log(`[session:${session.info.id}] tool approved: ${toolName}`);
      return { behavior: 'allow', updatedInput: input };
    }
    console.log(`[session:${session.info.id}] tool denied: ${toolName} — ${result.message || 'User denied'}`);
    return { behavior: 'deny', message: result.message || 'User denied' };
  }

  private async handleAskUserQuestion(
    session: ManagedSession,
    input: Record<string, unknown>
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> }> {
    const questionId = uuid();
    const question: PendingQuestion = {
      id: questionId,
      questions: (input as any).questions ?? [],
      timestamp: new Date().toISOString(),
    };

    this.updateStatus(session, 'awaiting_answer');
    this.emit(session.info.id, 'question', question);

    const answers = await new Promise<Record<string, string>>((resolve) => {
      session.pendingQuestion = { question, resolve };
    });

    session.pendingQuestion = null;
    this.updateStatus(session, 'running');

    return {
      behavior: 'allow',
      updatedInput: { ...input, answers },
    };
  }

  private handleSDKMessage(session: ManagedSession, message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          session.sdkSessionId = message.session_id;
          session.info.model = (message as any).model ?? null;
          console.log(`[session:${session.info.id}] SDK initialized, sdk_session: ${message.session_id}, model: ${session.info.model}`);
          this.updateStatus(session, 'running');
        }
        break;
      }

      case 'assistant': {
        // Extract the actual model from the API response
        const responseModel = (message.message as any).model;
        if (responseModel && responseModel !== session.info.model) {
          session.info.model = responseModel;
          this.emit(session.info.id, 'session_update', session.info);
        }

        const textBlocks = message.message.content.filter(
          (b: any) => b.type === 'text'
        );
        const toolBlocks = message.message.content.filter(
          (b: any) => b.type === 'tool_use'
        );

        for (const block of textBlocks) {
          if ((block as any).text) {
            session.hasAssistantMessage = true;
            this.addMessage(session, {
              id: message.uuid || uuid(),
              sessionId: session.info.id,
              type: 'assistant',
              content: (block as any).text,
              timestamp: new Date().toISOString(),
            });
          }
        }

        for (const block of toolBlocks) {
          const name = (block as any).name;

          // Detect EnterPlanMode from the message stream so it works even
          // when canUseTool is skipped (e.g. bypassPermissions mode).
          if (name === 'EnterPlanMode' && session.info.permissionMode !== 'plan') {
            session.info.permissionMode = 'plan';
            session.queryStream?.setPermissionMode('plan');
            this.emit(session.info.id, 'session_update', session.info);
            console.log(`[session:${session.info.id}] entered plan mode`);
          }
          // Note: ExitPlanMode is handled in canUseTool (only on approval),
          // NOT here — switching here would exit plan mode before the user approves.

          this.addMessage(session, {
            id: (block as any).id || uuid(),
            sessionId: session.info.id,
            type: 'tool_call',
            content: JSON.stringify((block as any).input, null, 2),
            toolName: name,
            toolInput: (block as any).input,
            timestamp: new Date().toISOString(),
          });
        }

        break;
      }

      case 'user': {
        // Tool results come back as user messages
        if (message.parent_tool_use_id) {
          const content = Array.isArray(message.message.content)
            ? message.message.content
                .map((b: any) => (b.type === 'tool_result' ? JSON.stringify(b.content) : b.text || ''))
                .join('\n')
            : String(message.message.content);

          this.addMessage(session, {
            id: message.uuid || uuid(),
            sessionId: session.info.id,
            type: 'tool_result',
            content,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'stream_event': {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          this.emit(session.info.id, 'stream', {
            messageId: (message as any).uuid || 'streaming',
            token: event.delta.text,
          });
        }
        break;
      }

      case 'result': {
        const result = message as any;
        session.info.totalCostUsd = result.total_cost_usd ?? session.info.totalCostUsd;
        const isError = result.is_error ?? false;
        console.log(
          `[session:${session.info.id}] result: ${isError ? 'ERROR' : 'ok'}, cost: $${(result.total_cost_usd ?? 0).toFixed(4)}`
        );

        // Surface command result text when no assistant messages were emitted this turn
        // (e.g. slash commands like /help, /model, /cost)
        const resultText = result.result ?? '';
        if (resultText && !session.hasAssistantMessage) {
          this.addMessage(session, {
            id: uuid(),
            sessionId: session.info.id,
            type: 'system',
            content: resultText,
            timestamp: new Date().toISOString(),
          });
        }

        this.updateStatus(session, 'idle');
        this.emit(session.info.id, 'result', {
          result: resultText,
          costUsd: result.total_cost_usd ?? 0,
          isError,
        });
        break;
      }
    }
  }

  sendMessage(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.addMessage(session, {
      id: uuid(),
      sessionId,
      type: 'user',
      content,
      timestamp: new Date().toISOString(),
    });

    session.hasAssistantMessage = false;

    session.channel.push({
      type: 'user',
      session_id: session.sdkSessionId || '',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    } as any);
  }

  approveToolUse(sessionId: string, approvalId: string, allow: boolean, message?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingApproval) return;
    if (session.pendingApproval.approval.id !== approvalId) return;

    session.pendingApproval.resolve({
      behavior: allow ? 'allow' : 'deny',
      message,
    });
  }

  answerQuestion(sessionId: string, questionId: string, answers: Record<string, string>): void {
    const session = this.sessions.get(sessionId);
    if (!session?.pendingQuestion) return;
    if (session.pendingQuestion.question.id !== questionId) return;

    session.pendingQuestion.resolve(answers);
  }

  async interruptSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const { status } = session.info;
    if (status === 'idle' || status === 'terminated' || status === 'error') return;

    console.log(`[session:${sessionId}] interrupting (was ${status})`);

    // Resolve any pending approval/question so the awaiting promises settle
    if (session.pendingApproval) {
      session.pendingApproval.resolve({ behavior: 'deny', message: 'Interrupted by user' });
      session.pendingApproval = null;
    }
    if (session.pendingQuestion) {
      session.pendingQuestion.resolve({});
      session.pendingQuestion = null;
    }

    // Gracefully interrupt the current turn — the SDK will emit a `result`
    // message which triggers updateStatus(session, 'idle') through handleSDKMessage
    session.queryStream?.interrupt();
  }

  async getSupportedModels(sessionId: string): Promise<{ value: string; displayName: string; description: string }[]> {
    const session = this.sessions.get(sessionId);
    if (!session?.queryStream) return [];
    try {
      const models = await session.queryStream.supportedModels();
      console.log(`[session:${sessionId}] supportedModels:`, JSON.stringify(models));
      return models;
    } catch (err) {
      console.error(`[session:${sessionId}] failed to get supported models:`, err);
      return [];
    }
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.queryStream) return;
    try {
      await session.queryStream.setModel(model);
      session.info.model = model;
      console.log(`[session:${sessionId}] model changed to: ${model}`);
      this.emit(sessionId, 'session_update', session.info);
      this.addMessage(session, {
        id: uuid(),
        sessionId,
        type: 'system',
        content: `Model changed to ${model}`,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[session:${sessionId}] failed to set model:`, err);
      this.addMessage(session, {
        id: uuid(),
        sessionId,
        type: 'error',
        content: `Failed to change model: ${err.message || 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  updateSessionSettings(sessionId: string, settings: SessionSettingsUpdate): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (settings.name !== undefined) {
      session.info.name = settings.name;
    }
    if (settings.permissionMode !== undefined) {
      session.info.permissionMode = settings.permissionMode;
      session.queryStream?.setPermissionMode(toSDKPermissionMode(settings.permissionMode));
    }
    if (settings.notificationsEnabled !== undefined) {
      session.info.notificationsEnabled = settings.notificationsEnabled;
    }

    this.emit(sessionId, 'session_update', session.info);
  }

  terminateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.abortController.abort();
    session.channel.close();
    this.updateStatus(session, 'terminated');
  }

  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.abortController.abort();
    session.channel.close();
    this.sessions.delete(sessionId);
  }

  private updateStatus(session: ManagedSession, status: SessionStatus): void {
    session.info.status = status;
    this.emit(session.info.id, 'session_update', session.info);
  }

  private addMessage(session: ManagedSession, message: SessionMessage): void {
    session.messages.push(message);
    session.info.lastMessageAt = message.timestamp;
    session.info.lastMessagePreview =
      message.content.length > 100
        ? message.content.slice(0, 100) + '...'
        : message.content;
    this.emit(session.info.id, 'messages', [message]);
  }
}
