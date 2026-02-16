// Session and message types shared between server and client

export type PermissionMode = 'normal' | 'auto_edits' | 'dangerous' | 'plan';

export type SessionStatus =
  | 'starting'
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_answer'
  | 'error'
  | 'terminated';

export interface SessionInfo {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  status: SessionStatus;
  createdAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalCostUsd: number;
  permissionMode: PermissionMode;
  model: string | null;
  notificationsEnabled: boolean;
  contextUsage: ContextUsage | null;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'error';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  timestamp: string;
  isStreaming?: boolean;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: string;
}

export interface PendingQuestion {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  timestamp: string;
}

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  totalCostUsd: number;
  numTurns: number;
  durationMs: number;
  durationApiMs: number;
}
