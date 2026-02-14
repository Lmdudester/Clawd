import { useAuthStore } from '../stores/authStore';
import type {
  LoginRequest,
  LoginResponse,
  CreateSessionRequest,
  SessionListResponse,
  SessionDetailResponse,
  ErrorResponse,
  AuthStatusResponse,
  SetCredentialsPathRequest,
  DiscoverCredentialsResponse,
  ProjectFoldersResponse,
  ProjectFolder,
} from '@clawd/shared';

const BASE_URL = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    useAuthStore.getState().logout();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  login: (data: LoginRequest) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  getSessions: () =>
    request<SessionListResponse>('/sessions'),

  createSession: (data: CreateSessionRequest) =>
    request<{ session: import('@clawd/shared').SessionInfo }>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSession: (id: string) =>
    request<SessionDetailResponse>(`/sessions/${id}`),

  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: 'DELETE' }),

  // Settings
  getAuthStatus: () =>
    request<AuthStatusResponse>('/settings/auth'),

  discoverCredentials: () =>
    request<DiscoverCredentialsResponse>('/settings/auth/discover'),

  setAuthCredentials: (credentialsPath: string) =>
    request<AuthStatusResponse>('/settings/auth', {
      method: 'PUT',
      body: JSON.stringify({ credentialsPath } satisfies SetCredentialsPathRequest),
    }),

  clearAuth: () =>
    request<AuthStatusResponse>('/settings/auth', { method: 'DELETE' }),

  // Project Folders
  getProjectFolders: () =>
    request<ProjectFoldersResponse>('/settings/folders'),

  setProjectFolders: (folders: ProjectFolder[]) =>
    request<ProjectFoldersResponse>('/settings/folders', {
      method: 'PUT',
      body: JSON.stringify({ folders }),
    }),
};
