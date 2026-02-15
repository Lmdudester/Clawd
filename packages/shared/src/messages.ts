// WebSocket protocol types

export interface SessionSettingsUpdate {
  name?: string;
  permissionMode?: import('./session.js').PermissionMode;
  notificationsEnabled?: boolean;
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
}

// Client → Server messages
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'send_prompt'; sessionId: string; content: string }
  | { type: 'approve_tool'; sessionId: string; approvalId: string; allow: boolean; message?: string }
  | { type: 'answer_question'; sessionId: string; questionId: string; answers: Record<string, string> }
  | { type: 'interrupt'; sessionId: string }
  | { type: 'update_session_settings'; sessionId: string; settings: SessionSettingsUpdate }
  | { type: 'get_models'; sessionId: string }
  | { type: 'set_model'; sessionId: string; model: string };

// Server → Client messages
export type ServerMessage =
  | { type: 'auth_ok' }
  | { type: 'auth_error'; message: string }
  | { type: 'session_update'; session: import('./session.js').SessionInfo }
  | { type: 'messages'; sessionId: string; messages: import('./session.js').SessionMessage[] }
  | { type: 'stream'; sessionId: string; messageId: string; token: string }
  | { type: 'stream_end'; sessionId: string; messageId: string }
  | { type: 'approval_request'; sessionId: string; approval: import('./session.js').PendingApproval }
  | { type: 'question'; sessionId: string; question: import('./session.js').PendingQuestion }
  | { type: 'result'; sessionId: string; result: string; costUsd: number; isError: boolean; contextUsage: import('./session.js').ContextUsage | null }
  | { type: 'models_list'; sessionId: string; models: ModelInfo[] }
  | { type: 'error'; sessionId: string; message: string };
