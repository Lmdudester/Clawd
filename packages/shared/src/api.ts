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
