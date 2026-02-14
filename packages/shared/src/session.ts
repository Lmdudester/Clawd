// Session and message types shared between server and client

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_answer'
  | 'error'
  | 'terminated';

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  createdAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalCostUsd: number;
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
