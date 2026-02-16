// Internal WebSocket protocol between master server and session agents.
// This is NOT the client-facing protocol (see messages.ts for that).

import type { SessionMessage, PendingApproval, PendingQuestion, SessionStatus, ContextUsage } from './session.js';

// Session Agent -> Master messages
export type AgentToMasterMessage =
  | { type: 'auth'; sessionId: string; token: string }
  | { type: 'ready' }
  | { type: 'setup_progress'; message: string }
  | { type: 'sdk_message'; message: SessionMessage }
  | { type: 'stream'; messageId: string; token: string }
  | { type: 'approval_request'; approval: PendingApproval }
  | { type: 'question'; question: PendingQuestion }
  | { type: 'result'; result: string; costUsd: number; isError: boolean; contextUsage: ContextUsage | null }
  | { type: 'status_update'; status: SessionStatus }
  | { type: 'session_info_update'; model?: string; permissionMode?: string; totalCostUsd?: number; contextUsage?: ContextUsage }
  | { type: 'models_list'; models: Array<{ value: string; displayName: string; description: string }> }
  | { type: 'error'; message: string };

// Master -> Session Agent messages
export type MasterToAgentMessage =
  | { type: 'auth_ok' }
  | { type: 'user_message'; content: string }
  | { type: 'approval_response'; approvalId: string; allow: boolean; message?: string }
  | { type: 'question_response'; questionId: string; answers: Record<string, string> }
  | { type: 'interrupt' }
  | { type: 'update_settings'; permissionMode?: string; name?: string; notificationsEnabled?: boolean }
  | { type: 'set_model'; model: string }
  | { type: 'get_models' }
  | { type: 'token_update'; token: string };
