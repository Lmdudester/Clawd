// SDK runner — extracted from session-manager.ts.
// Runs the Claude Agent SDK query() in the session container and communicates
// all events back to the master via the MasterClient.

import { query, type SDKMessage, type Query } from '@anthropic-ai/claude-agent-sdk';
import { v4 as uuid } from 'uuid';
import type { MasterClient } from './master-client.js';
import type {
  PermissionMode,
  PendingApproval,
  PendingQuestion,
  ContextUsage,
  MasterToAgentMessage,
} from '@clawd/shared';
import type { ClawdConfig } from '@clawd/shared';

const READONLY_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'EnterPlanMode', 'TodoRead', 'TaskList', 'TaskGet',
]);
const READONLY_MCP_PREFIXES = ['mcp__playwright__'];

// Bash commands that are safe to auto-approve without user interaction
const READONLY_BASH_PATTERNS = [
  // gh CLI read-only subcommands
  /^gh\s+repo\s+view\b/,
  /^gh\s+pr\s+(list|view|status|checks|diff)\b/,
  /^gh\s+issue\s+(list|view|status)\b/,
  /^gh\s+release\s+(list|view)\b/,
  /^gh\s+run\s+(list|view)\b/,
  /^gh\s+workflow\s+(list|view)\b/,
  /^gh\s+api\s/,          // gh api (GET by default)
  /^gh\s+search\s/,       // gh search repos/issues/prs/commits
  /^gh\s+status\b/,
  // General-purpose safe commands
  /^sleep\s/,
  /^curl\s/,
  /^head\b/,
  /^tail\b/,
];

export function isReadOnlyBash(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName !== 'Bash') return false;
  const cmd = (typeof input.command === 'string' ? input.command : '').trim();
  // Reject gh api with --method that isn't GET
  if (/^gh\s+api\s/.test(cmd) && /--method\s+(?!GET\b)/i.test(cmd)) return false;
  return READONLY_BASH_PATTERNS.some(p => p.test(cmd));
}

export function getEditFilePath(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return (input.file_path as string) || null;
    case 'NotebookEdit':
      return (input.notebook_path as string) || null;
    default:
      return null;
  }
}

interface SDKRunnerOptions {
  cwd: string;
  permissionMode: PermissionMode;
  masterClient: MasterClient;
  config?: ClawdConfig;
}

export class SDKRunner {
  private queryStream: Query | null = null;
  private abortController = new AbortController();
  private permissionMode: PermissionMode;
  private masterClient: MasterClient;
  private cwd: string;
  private config?: ClawdConfig;
  private hasAssistantMessage = false;

  // Cumulative context tracking
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  private cumulativeCacheReadTokens = 0;
  private cumulativeCacheCreationTokens = 0;

  // Serialization gate for tool approvals — ensures only one approval dialog
  // is in-flight at a time. Uses promise chaining (each caller captures the
  // current gate, installs its own, then awaits the previous) for strict FIFO.
  private approvalGate: Promise<void> | null = null;
  private interrupted = false;
  private deferredInterrupt = false;
  private queryTurnInProgress = false;
  private queryTurnDone: Promise<void> = Promise.resolve();
  private resolveQueryTurn: (() => void) | null = null;

  // Pending approval/question promises
  private pendingApproval: {
    approval: PendingApproval;
    resolve: (result: { behavior: 'allow' | 'deny'; message?: string }) => void;
  } | null = null;
  private pendingQuestion: {
    question: PendingQuestion;
    resolve: (answers: Record<string, string>) => void;
  } | null = null;

  constructor(options: SDKRunnerOptions) {
    this.cwd = options.cwd;
    this.permissionMode = options.permissionMode;
    this.masterClient = options.masterClient;
    this.config = options.config;
  }

  handleMasterMessage(message: MasterToAgentMessage): void {
    switch (message.type) {
      case 'user_message':
        this.sendUserMessage(message.content);
        break;
      case 'approval_response':
        this.resolveApproval(message.approvalId, message.allow, message.message);
        break;
      case 'question_response':
        this.resolveQuestion(message.questionId, message.answers);
        break;
      case 'interrupt':
        this.interrupt();
        break;
      case 'update_settings':
        if (message.permissionMode !== undefined && message.permissionMode !== this.permissionMode) {
          const oldMode = this.permissionMode;
          this.permissionMode = message.permissionMode as PermissionMode;
          console.log(`[agent] permission mode changed: ${oldMode} -> ${this.permissionMode}`);
          // Update the SDK's own mode (plan vs default). For non-plan modes
          // the SDK stays in 'default' and our canUseTool callback enforces
          // the actual permission semantics (dangerous/auto_edits/normal).
          const sdkMode = this.permissionMode === 'plan' ? 'plan' : 'default';
          if (this.queryStream) {
            this.queryStream.setPermissionMode(sdkMode);
          }
        }
        break;
      case 'set_model':
        this.setModel(message.model);
        break;
      case 'get_models':
        this.getModels();
        break;
      case 'token_update':
        process.env.CLAUDE_CODE_OAUTH_TOKEN = message.token;
        console.log('[agent] OAuth token updated from master');
        break;
    }
  }

  // AsyncIterable message channel for feeding prompts to the SDK
  private messageQueue: Array<{ resolve: (msg: any) => void }> = [];
  private pendingMessages: any[] = [];
  private channelClosed = false;

  private channel = {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<any>> => {
        if (this.pendingMessages.length > 0) {
          return Promise.resolve({ value: this.pendingMessages.shift()!, done: false });
        }
        if (this.channelClosed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise((resolve) => {
          this.messageQueue.push({
            resolve: (msg: any) => resolve({ value: msg, done: false }),
          });
        });
      },
    }),
  };

  private pushToChannel(message: any): void {
    if (this.channelClosed) return;
    if (this.messageQueue.length > 0) {
      const waiter = this.messageQueue.shift()!;
      waiter.resolve(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  private closeChannel(): void {
    this.channelClosed = true;
    for (const waiter of this.messageQueue) {
      waiter.resolve(undefined);
    }
    this.messageQueue = [];
  }

  private sdkSessionId: string | null = null;

  private async sendUserMessage(content: string): Promise<void> {
    // If a query turn is already in progress, interrupt it and wait for it
    // to fully complete before starting the next one. This prevents the
    // abort controller and status flags from getting out of sync when the
    // user sends messages rapidly.
    if (this.queryTurnInProgress) {
      this.interrupt();
      await this.queryTurnDone;
    }

    this.interrupted = false;

    this.masterClient.send({
      type: 'sdk_message',
      message: {
        id: uuid(),
        sessionId: '',
        type: 'user',
        content,
        timestamp: new Date().toISOString(),
      },
    });

    this.hasAssistantMessage = false;

    // Mark a new turn as in-progress and create a promise that resolves
    // when the SDK emits the 'result' message for this turn.
    this.queryTurnInProgress = true;
    this.queryTurnDone = new Promise<void>((resolve) => {
      this.resolveQueryTurn = resolve;
    });

    this.pushToChannel({
      type: 'user',
      session_id: this.sdkSessionId || '',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
  }

  private resolveApproval(approvalId: string, allow: boolean, message?: string): void {
    if (!this.pendingApproval || this.pendingApproval.approval.id !== approvalId) return;
    this.pendingApproval.resolve({
      behavior: allow ? 'allow' : 'deny',
      message,
    });
  }

  private resolveQuestion(questionId: string, answers: Record<string, string>): void {
    if (!this.pendingQuestion || this.pendingQuestion.question.id !== questionId) return;
    this.pendingQuestion.resolve(answers);
  }

  private interrupt(): void {
    this.interrupted = true;

    if (this.pendingApproval || this.pendingQuestion) {
      // A canUseTool callback is in-flight. Calling queryStream.interrupt()
      // now would race with the SDK's control_response for the pending
      // request, corrupting conversation state (duplicate tool_use ids).
      // Instead, resolve the pending promise immediately and defer the
      // interrupt until after the canUseTool callback returns.
      this.deferredInterrupt = true;
      if (this.pendingApproval) {
        this.pendingApproval.resolve({ behavior: 'deny', message: 'Interrupted by user' });
        this.pendingApproval = null;
      }
      if (this.pendingQuestion) {
        this.pendingQuestion.resolve({});
        this.pendingQuestion = null;
      }
    } else {
      // No pending callback — interrupt immediately.
      this.queryStream?.interrupt();
    }
  }

  private async setModel(model: string): Promise<void> {
    if (!this.queryStream) return;
    try {
      await this.queryStream.setModel(model);
      this.masterClient.send({
        type: 'session_info_update',
        model,
      });
      this.masterClient.send({
        type: 'sdk_message',
        message: {
          id: uuid(),
          sessionId: '',
          type: 'system',
          content: `Model changed to ${model}`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      this.masterClient.send({
        type: 'sdk_message',
        message: {
          id: uuid(),
          sessionId: '',
          type: 'error',
          content: `Failed to change model: ${err.message || 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  private async getModels(): Promise<void> {
    if (!this.queryStream) return;
    try {
      const models = await this.queryStream.supportedModels();
      this.masterClient.send({ type: 'models_list', models });
    } catch (err) {
      console.error('[agent] Failed to get supported models:', err);
    }
  }

  private getEditFilePathForApproval(toolName: string, input: Record<string, unknown>): string | null {
    return getEditFilePath(toolName, input);
  }

  async run(): Promise<void> {
    try {
      // Build MCP servers config
      const mcpServers: Record<string, { type: 'stdio'; command: string; args: string[] }> = {
        playwright: {
          type: 'stdio',
          command: 'npx',
          args: ['@playwright/mcp', '--browser', 'chromium'],
        },
      };

      // Add MCP servers from .clawd.yml
      if (this.config?.mcp) {
        for (const [name, server] of Object.entries(this.config.mcp)) {
          mcpServers[name] = {
            type: 'stdio',
            command: server.command,
            args: server.args ?? [],
          };
        }
      }

      // Build environment
      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_OPTIONS;
      delete cleanEnv.VSCODE_INSPECTOR_OPTIONS;
      delete cleanEnv.CLAUDECODE;

      // Add env vars from .clawd.yml
      if (this.config?.env) {
        Object.assign(cleanEnv, this.config.env);
      }

      // Build system prompt
      const systemPrompt: any = {
        type: 'preset',
        preset: 'claude_code',
        append: [
          'You are running inside a Clawd session container.',
          'IMPORTANT: Do not explore or read source files unless the task specifically requires understanding the code.',
          'This project\'s CLAUDE.md already gives you the architecture and key paths — trust it instead of reading files to orient yourself.',
          'When a skill provides step-by-step instructions, follow them immediately without any preliminary exploration.',
        ].join(' '),
      };

      const queryStream = query({
        prompt: this.channel as AsyncIterable<any>,
        options: {
          cwd: this.cwd,
          env: cleanEnv,
          abortController: this.abortController,
          includePartialMessages: true,
          systemPrompt,
          settingSources: ['user', 'project'],
          permissionMode: this.permissionMode === 'plan' ? 'plan' : 'default',
          mcpServers,
          canUseTool: async (toolName, input, options) => {
            // Dangerous: approve everything
            if (this.permissionMode === 'dangerous') {
              console.log(`[agent] auto-approved: ${toolName}`);
              return { behavior: 'allow', updatedInput: input };
            }
            // Auto-edits: approve file mutations within CWD
            if (this.permissionMode === 'auto_edits') {
              const filePath = this.getEditFilePathForApproval(toolName, input);
              const normalizedFile = filePath?.replace(/\\/g, '/');
              const normalizedCwd = this.cwd.replace(/\\/g, '/');
              if (normalizedFile && normalizedFile.startsWith(normalizedCwd + '/')) {
                console.log(`[agent] auto-edit approved: ${toolName}`);
                return { behavior: 'allow', updatedInput: input };
              }
            }
            const result = await this.handleToolApproval(toolName, input, options?.signal);
            // If an interrupt was deferred (waiting for this callback to
            // finish), fire it now. The SDK will send the control_response
            // for this canUseTool call first, then process the interrupt.
            if (this.deferredInterrupt) {
              this.deferredInterrupt = false;
              this.queryStream?.interrupt();
            }
            return result;
          },
          stderr: (data: string) => {
            console.error(`[agent] claude stderr: ${data}`);
          },
        },
      });

      this.queryStream = queryStream;

      for await (const message of queryStream) {
        this.handleSDKMessage(message);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[agent] aborted');
        return;
      }
      console.error('[agent] SDK query error:', err);
      this.masterClient.send({ type: 'status_update', status: 'error' });
      this.masterClient.send({
        type: 'sdk_message',
        message: {
          id: uuid(),
          sessionId: '',
          type: 'error',
          content: err.message || 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  private async handleToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    // --- Pre-gate fast paths (no serialization needed) ---

    // Handle AskUserQuestion specially
    if (toolName === 'AskUserQuestion') {
      return this.handleAskUserQuestion(input, signal);
    }

    // Plan mode guard: allow read-only tools, deny mutations (no gate)
    if (this.permissionMode === 'plan' && toolName !== 'ExitPlanMode') {
      if (READONLY_TOOLS.has(toolName) ||
          READONLY_MCP_PREFIXES.some(p => toolName.startsWith(p)) ||
          isReadOnlyBash(toolName, input)) {
        return { behavior: 'allow', updatedInput: input };
      }
      console.log(`[agent] plan mode blocked tool: ${toolName}`);
      return { behavior: 'deny', message: 'Tool execution is not allowed in plan mode' };
    }

    // Auto-approve read-only tools (normal + auto_edits modes, no gate)
    if (READONLY_TOOLS.has(toolName) ||
        READONLY_MCP_PREFIXES.some(p => toolName.startsWith(p)) ||
        isReadOnlyBash(toolName, input)) {
      return { behavior: 'allow', updatedInput: input };
    }

    // --- Acquire serialization gate ---
    // Promise chaining: capture current gate, install our own, await previous.
    // This gives strict FIFO ordering with no thundering herd.
    let releaseGate!: () => void;
    const previousGate = this.approvalGate;
    this.approvalGate = new Promise<void>((resolve) => { releaseGate = resolve; });

    try {
      if (previousGate) await previousGate;

      // If interrupted while waiting in the queue, deny immediately
      if (this.interrupted || signal?.aborted) {
        console.log(`[agent] queued approval denied (interrupted): ${toolName}`);
        return { behavior: 'deny', message: 'Interrupted by user' };
      }

      // ExitPlanMode — show approval dialog, switch to normal only if approved
      if (toolName === 'ExitPlanMode' && this.permissionMode === 'plan') {
        const result = await this.sendApprovalAndAwait(toolName, input, signal);

        if (result.behavior === 'allow') {
          this.permissionMode = 'normal';
          this.queryStream?.setPermissionMode('default');
          this.masterClient.send({
            type: 'session_info_update',
            permissionMode: 'normal',
          });
          console.log('[agent] exited plan mode -> normal');
          return { behavior: 'allow', updatedInput: input };
        }

        console.log('[agent] plan exit denied — staying in plan mode');
        return { behavior: 'deny', message: result.message || 'Plan not approved' };
      }

      // Normal approval dialog
      const result = await this.sendApprovalAndAwait(toolName, input, signal);

      if (result.behavior === 'allow') {
        console.log(`[agent] tool approved: ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      }
      console.log(`[agent] tool denied: ${toolName} — ${result.message || 'User denied'}`);
      return { behavior: 'deny', message: result.message || 'User denied' };
    } finally {
      releaseGate();
    }
  }

  /** Send an approval request to the master and await the user's response. */
  private async sendApprovalAndAwait(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ behavior: 'allow' | 'deny'; message?: string }> {
    const approvalId = uuid();
    const approval: PendingApproval = {
      id: approvalId,
      toolName,
      toolInput: input,
      timestamp: new Date().toISOString(),
    };

    this.masterClient.send({ type: 'status_update', status: 'awaiting_approval' });
    this.masterClient.send({ type: 'approval_request', approval });

    const promises: Promise<{ behavior: 'allow' | 'deny'; message?: string }>[] = [
      new Promise<{ behavior: 'allow' | 'deny'; message?: string }>((resolve) => {
        this.pendingApproval = { approval, resolve };
      }),
      new Promise<{ behavior: 'deny'; message: string }>((resolve) =>
        setTimeout(() => {
          console.warn(`[agent] tool approval timed out for ${toolName}`);
          resolve({ behavior: 'deny', message: 'Approval timed out (5 min)' });
        }, 5 * 60 * 1000)
      ),
    ];
    if (signal) {
      promises.push(new Promise((resolve) => {
        if (signal.aborted) return resolve({ behavior: 'deny', message: 'Interrupted by user' });
        signal.addEventListener('abort', () => resolve({ behavior: 'deny', message: 'Interrupted by user' }), { once: true });
      }));
    }
    const result = await Promise.race(promises);

    this.pendingApproval = null;
    this.masterClient.send({ type: 'status_update', status: 'running' });

    return result;
  }

  private async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    const questionId = uuid();
    const question: PendingQuestion = {
      id: questionId,
      questions: (input as any).questions ?? [],
      timestamp: new Date().toISOString(),
    };

    this.masterClient.send({ type: 'status_update', status: 'awaiting_answer' });
    this.masterClient.send({ type: 'question', question });

    const answers = await Promise.race([
      new Promise<Record<string, string>>((resolve) => {
        this.pendingQuestion = { question, resolve };
      }),
      ...(signal ? [new Promise<never>((_, reject) => {
        if (signal.aborted) return reject(new Error('Interrupted'));
        signal.addEventListener('abort', () => reject(new Error('Interrupted')), { once: true });
      })] : []),
    ]).catch(() => null);

    this.pendingQuestion = null;
    this.masterClient.send({ type: 'status_update', status: 'running' });

    if (answers === null) {
      return { behavior: 'deny', message: 'Interrupted by user' };
    }

    return {
      behavior: 'allow',
      updatedInput: { ...input, answers },
    };
  }

  private handleSDKMessage(message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          this.sdkSessionId = message.session_id;
          const model = (message as any).model ?? null;
          console.log(`[agent] SDK initialized, sdk_session: ${message.session_id}, model: ${model}`);
          this.masterClient.send({
            type: 'session_info_update',
            model,
          });
          this.masterClient.send({ type: 'status_update', status: 'running' });
        }
        break;
      }

      case 'assistant': {
        const responseModel = (message.message as any).model;
        if (responseModel) {
          this.masterClient.send({
            type: 'session_info_update',
            model: responseModel,
          });
        }

        const textBlocks = message.message.content.filter(
          (b: any) => b.type === 'text'
        );
        const toolBlocks = message.message.content.filter(
          (b: any) => b.type === 'tool_use'
        );

        for (const block of textBlocks) {
          if ((block as any).text) {
            this.hasAssistantMessage = true;
            this.masterClient.send({
              type: 'sdk_message',
              message: {
                id: message.uuid || uuid(),
                sessionId: '',
                type: 'assistant',
                content: (block as any).text,
                timestamp: new Date().toISOString(),
              },
            });
          }
        }

        for (const block of toolBlocks) {
          const name = (block as any).name;

          // Detect EnterPlanMode from the message stream
          if (name === 'EnterPlanMode' && this.permissionMode !== 'plan') {
            this.permissionMode = 'plan';
            this.queryStream?.setPermissionMode('plan');
            this.masterClient.send({
              type: 'session_info_update',
              permissionMode: 'plan',
            });
            console.log('[agent] entered plan mode');
          }

          this.masterClient.send({
            type: 'sdk_message',
            message: {
              id: (block as any).id || uuid(),
              sessionId: '',
              type: 'tool_call',
              content: JSON.stringify((block as any).input, null, 2),
              toolName: name,
              toolInput: (block as any).input,
              timestamp: new Date().toISOString(),
            },
          });
        }

        break;
      }

      case 'user': {
        if (message.parent_tool_use_id) {
          const content = Array.isArray(message.message.content)
            ? message.message.content
                .map((b: any) => (b.type === 'tool_result' ? JSON.stringify(b.content) : b.text || ''))
                .join('\n')
            : String(message.message.content);

          this.masterClient.send({
            type: 'sdk_message',
            message: {
              id: message.uuid || uuid(),
              sessionId: '',
              type: 'tool_result',
              content,
              timestamp: new Date().toISOString(),
            },
          });
        }
        break;
      }

      case 'stream_event': {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          this.masterClient.send({
            type: 'stream',
            messageId: (message as any).uuid || 'streaming',
            token: event.delta.text,
          });
        }
        break;
      }

      case 'result': {
        const result = message as any;
        const totalCostUsd = result.total_cost_usd ?? 0;
        const isError = result.is_error ?? false;
        console.log(`[agent] result: ${isError ? 'ERROR' : 'ok'}, cost: $${totalCostUsd.toFixed(4)}`);

        // Extract usage from this turn
        const usage = result.usage;
        const lastTurnInputTokens = usage?.input_tokens ?? 0;
        const lastTurnOutputTokens = usage?.output_tokens ?? 0;
        const lastTurnCacheReadTokens = usage?.cache_read_input_tokens ?? 0;
        const lastTurnCacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;

        // Accumulate tokens
        this.cumulativeInputTokens += lastTurnInputTokens;
        this.cumulativeOutputTokens += lastTurnOutputTokens;
        this.cumulativeCacheReadTokens += lastTurnCacheReadTokens;
        this.cumulativeCacheCreationTokens += lastTurnCacheCreationTokens;

        // Extract maxOutputTokens from model metadata
        const modelUsageMap = result.modelUsage as Record<string, any> | undefined;
        let maxOutputTokens = 0;

        if (modelUsageMap) {
          const models = Object.entries(modelUsageMap);
          if (models.length > 0) {
            if (models.length > 1) {
              console.warn('[agent] Multiple models in modelUsage:', models.map(([k]) => k));
            }
            const [modelName, modelData] = models[0];
            maxOutputTokens = modelData.maxOutputTokens ?? 0;
            console.log(`[agent] Model: ${modelName}`);
          } else {
            console.warn('[agent] modelUsage is empty object');
          }
        } else {
          console.warn('[agent] No modelUsage in result');
        }

        console.log(
          `[agent] Token usage - Input: ${this.cumulativeInputTokens}, ` +
          `Output: ${this.cumulativeOutputTokens}, ` +
          `Cache Read: ${this.cumulativeCacheReadTokens}, ` +
          `Cache Creation: ${this.cumulativeCacheCreationTokens}`
        );

        const contextUsage: ContextUsage = {
          // Cumulative totals
          cumulativeInputTokens: this.cumulativeInputTokens,
          cumulativeOutputTokens: this.cumulativeOutputTokens,
          cumulativeCacheReadTokens: this.cumulativeCacheReadTokens,
          cumulativeCacheCreationTokens: this.cumulativeCacheCreationTokens,

          // Last turn only
          lastTurnInputTokens,
          lastTurnOutputTokens,
          lastTurnCacheReadTokens,
          lastTurnCacheCreationTokens,

          // Session metadata
          maxOutputTokens,
          totalCostUsd,
          numTurns: result.num_turns ?? 0,
          durationMs: result.duration_ms ?? 0,
          durationApiMs: result.duration_api_ms ?? 0,
        };

        this.masterClient.send({
          type: 'session_info_update',
          totalCostUsd,
          contextUsage,
        });

        // Surface command result text when no assistant messages were emitted this turn
        const resultText = result.result ?? '';
        if (resultText && !this.hasAssistantMessage) {
          this.masterClient.send({
            type: 'sdk_message',
            message: {
              id: uuid(),
              sessionId: '',
              type: 'system',
              content: resultText,
              timestamp: new Date().toISOString(),
            },
          });
        }

        this.masterClient.send({
          type: 'result',
          result: resultText,
          costUsd: totalCostUsd,
          isError,
          contextUsage,
        });

        // Signal that this query turn is done so any queued user message
        // can proceed safely.
        this.queryTurnInProgress = false;
        if (this.resolveQueryTurn) {
          this.resolveQueryTurn();
          this.resolveQueryTurn = null;
        }

        break;
      }
    }
  }

  abort(): void {
    this.abortController.abort();
    this.closeChannel();
  }
}
