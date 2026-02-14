// REST API request/response types

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

export interface CreateSessionRequest {
  name: string;
  cwd: string;
}

export interface SessionListResponse {
  sessions: import('./session.js').SessionInfo[];
}

export interface SessionDetailResponse {
  session: import('./session.js').SessionInfo;
  messages: import('./session.js').SessionMessage[];
}

export interface ErrorResponse {
  error: string;
}

// Settings API types

export interface AuthStatusResponse {
  method: 'oauth_credentials_file' | 'env_fallback' | 'none';
  credentialsPath: string | null;
  maskedToken: string | null;
  hasEnvFallback: boolean;
}

export interface SetCredentialsPathRequest {
  credentialsPath: string;
}

export interface DiscoverCredentialsResponse {
  paths: string[];
}

// Project Folders API types

export interface ProjectFolder {
  path: string;
  label: string;
  isDefault: boolean;
}

export interface ProjectFoldersResponse {
  folders: ProjectFolder[];
}

export interface SetProjectFoldersRequest {
  folders: ProjectFolder[];
}

// Usage / Rate Limit types

// Standard API tier bucket (requests, tokens, input-tokens, output-tokens)
export interface RateLimitBucket {
  limit: number;
  remaining: number;
  reset: string; // ISO 8601
}

// Claude Max unified bucket (5h, 7d windows)
export interface UnifiedBucket {
  utilization: number; // 0.0 – 1.0
  reset: number; // epoch seconds
  status: string; // "allowed" | "rejected" etc.
}

export interface UsageResponse {
  // Standard API tier fields
  requests: RateLimitBucket | null;
  tokens: RateLimitBucket | null;
  inputTokens: RateLimitBucket | null;
  outputTokens: RateLimitBucket | null;
  // Claude Max unified fields
  unified5h: UnifiedBucket | null;
  unified7d: UnifiedBucket | null;
  unifiedFallbackPct: number | null;
  //
  authMethod: 'oauth_credentials_file' | 'env_fallback' | 'none';
  fetchedAt: string;
}
