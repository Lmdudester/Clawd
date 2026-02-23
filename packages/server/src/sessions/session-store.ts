// File-based JSON persistence for session state.
// Follows the same pattern as ProjectRepoStore and CredentialStore:
// synchronous reads/writes on a single JSON file.

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import type { SessionInfo, SessionMessage, ManagerState } from '@clawd/shared';
import { config } from '../config.js';

export interface PersistedSession {
  info: SessionInfo;
  messages: SessionMessage[];
  sessionToken: string;
  containerId: string | null;
  managerApiToken: string | null;
  managerState: ManagerState | null;
}

export interface PersistedState {
  sessions: PersistedSession[];
  internalSecret: string;
}

export class SessionStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? config.sessionStorePath;
  }

  /** Load persisted state from disk. Returns null if file doesn't exist or is corrupt. */
  load(): PersistedState | null {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      // Basic validation
      if (!data || !Array.isArray(data.sessions) || typeof data.internalSecret !== 'string') {
        console.warn('[session-store] Invalid session store format, ignoring');
        return null;
      }
      return data as PersistedState;
    } catch {
      return null;
    }
  }

  /** Write state to disk atomically (write to .tmp then rename). */
  save(state: PersistedState): void {
    const tmpPath = this.filePath + '.tmp';
    try {
      writeFileSync(tmpPath, JSON.stringify(state, null, 2));
      renameSync(tmpPath, this.filePath);
    } catch (err: any) {
      console.error(`[session-store] Failed to save: ${err.message}`);
      // Clean up temp file on failure
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  /** Remove the persisted state file. */
  delete(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // File may not exist — that's fine
    }
  }
}
