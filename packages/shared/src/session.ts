// Session and message types shared between server and client

export type PermissionMode = 'normal' | 'auto_edits' | 'dangerous' | 'plan';

export type SessionStatus =
  | 'starting'
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_answer'
  | 'reconnecting'
  | 'error'
  | 'terminated';

export type ManagerStep = 'idle' | 'exploring' | 'triaging' | 'planning' | 'reviewing' | 'fixing' | 'testing' | 'merging';

export type ManagerFocus = 'bugs' | 'enhancements' | 'both';

export interface ManagerPreferences {
  focus: ManagerFocus;
  skipExploration: boolean;
  requirePlanApproval: boolean;
}

export interface ManagerState {
  targetBranch: string;
  currentStep: ManagerStep;
  childSessionIds: string[];
  preferences?: ManagerPreferences;
  paused?: boolean;
  resumeAt?: string; // ISO 8601 timestamp — when the timed resume is scheduled
}

export interface SessionInfo {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  dockerAccess: boolean;
  status: SessionStatus;
  createdAt: string;
  createdBy: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalCostUsd: number;
  permissionMode: PermissionMode;
  model: string | null;
  notificationsEnabled: boolean;
  contextUsage: ContextUsage | null;
  isManager?: boolean;
  managerState?: ManagerState;
  managedBy?: string;
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
  source?: 'child_event' | 'auto_continue';
}

export interface PendingApproval {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  reason?: string;
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
  // Cumulative session totals (for cost tracking)
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCacheReadTokens: number;
  cumulativeCacheCreationTokens: number;

  // Last turn only (for detailed view)
  lastTurnInputTokens: number;
  lastTurnOutputTokens: number;
  lastTurnCacheReadTokens: number;
  lastTurnCacheCreationTokens: number;

  // Session metadata
  maxOutputTokens: number;
  totalCostUsd: number;
  numTurns: number;
  durationMs: number;
  durationApiMs: number;
}
