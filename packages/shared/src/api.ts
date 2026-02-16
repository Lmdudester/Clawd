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
  repoUrl: string;
  branch: string;
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
  method: 'oauth_credentials_file' | 'none';
  credentialsPath: string | null;
  maskedToken: string | null;
}

export interface SetCredentialsPathRequest {
  credentialsPath: string;
}

export interface DiscoverCredentialsResponse {
  paths: string[];
}

// Project Repos API types (evolved from ProjectFolder)

export interface ProjectRepo {
  url: string;
  label: string;
  defaultBranch: string;
  isDefault: boolean;
}

export interface ProjectReposResponse {
  repos: ProjectRepo[];
}

export interface SetProjectReposRequest {
  repos: ProjectRepo[];
}

// Legacy aliases for backwards compatibility during migration
export type ProjectFolder = ProjectRepo;
export type ProjectFoldersResponse = ProjectReposResponse;
export type SetProjectFoldersRequest = SetProjectReposRequest;

// Branch API types

export interface BranchesResponse {
  branches: string[];
}

export interface CreateBranchRequest {
  repoUrl: string;
  branchName: string;
  fromBranch?: string;
}

export interface CreateBranchResponse {
  branch: string;
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
  authMethod: 'oauth_credentials_file' | 'none';
  fetchedAt: string;
}
