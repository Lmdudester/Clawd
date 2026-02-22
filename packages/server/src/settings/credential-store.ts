import { readFileSync, writeFileSync, unlinkSync, symlinkSync, existsSync, readdirSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { config } from '../config.js';
import type { AuthStatusResponse, TokenStatus } from '@clawd/shared';

interface StoredAuth {
  claudeDir: string;
}

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number; // Unix ms timestamp
    scopes?: string[];
  };
  accessToken?: string;
}

// Claude Code CLI OAuth client ID (public)
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// Refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Minimum interval between refresh attempts
const REFRESH_COOLDOWN_MS = 30 * 1000;
// Proactive check interval
const PROACTIVE_CHECK_INTERVAL_MS = 60 * 1000;

export class CredentialStore {
  private storedAuth: StoredAuth | null = null;
  private lastRefreshAttempt = 0;
  private refreshInProgress: Promise<boolean> | null = null;
  private refreshedListeners: Array<(newToken: string) => void> = [];
  private refreshFailedListeners: Array<(error: string) => void> = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.load();
    this.autoSelectIfSingle();
  }

  private load(): void {
    try {
      const raw = readFileSync(config.claudeAuthPath, 'utf-8');
      this.storedAuth = JSON.parse(raw);
    } catch {
      this.storedAuth = null;
    }
  }

  private autoSelectIfSingle(): void {
    if (this.storedAuth) return;
    const available = this.discoverCredentialFiles();
    if (available.length === 1) {
      console.log(`Auth: Auto-selecting only available credential: ${available[0]}`);
      this.setCredentialsPath(available[0]);
    }
  }

  private save(): void {
    if (this.storedAuth) {
      writeFileSync(config.claudeAuthPath, JSON.stringify(this.storedAuth, null, 2));
    } else {
      try { unlinkSync(config.claudeAuthPath); } catch {}
    }
  }

  // Scan for .credentials.json files in likely locations.
  discoverCredentialFiles(): string[] {
    const paths: string[] = [];

    if (config.hostDrivePrefix) {
      // Docker: scan mounted drive
      const usersDir = join(config.hostDrivePrefix, 'Users');
      try {
        const users = readdirSync(usersDir);
        for (const user of users) {
          const claudeDir = join(usersDir, user, '.claude');
          const credFile = join(claudeDir, '.credentials.json');
          if (existsSync(credFile)) {
            paths.push(claudeDir);
          }
        }
      } catch {}
    } else {
      // Local dev: check home directory
      const home = process.env.HOME || process.env.USERPROFILE || '';
      if (home) {
        const claudeDir = join(home, '.claude');
        const credFile = join(claudeDir, '.credentials.json');
        if (existsSync(credFile)) {
          paths.push(claudeDir);
        }
      }
    }

    return paths;
  }

  // Store the selected .claude directory path and set up symlink (Docker only).
  setCredentialsPath(claudeDir: string): void {
    const credFile = join(claudeDir, '.credentials.json');
    if (!existsSync(credFile)) {
      throw new Error(`Credentials file not found: ${credFile}`);
    }

    this.storedAuth = { claudeDir };
    this.save();

    // In Docker, symlink /root/.claude/.credentials.json -> the mounted path
    if (config.hostDrivePrefix) {
      this.setupSymlink(claudeDir);
    }
  }

  private setupSymlink(claudeDir: string): void {
    const targetFile = join(claudeDir, '.credentials.json');
    const home = homedir();
    const homeClaudeDir = join(home, '.claude');
    const symlinkPath = join(homeClaudeDir, '.credentials.json');

    // Ensure ~/.claude exists
    mkdirSync(homeClaudeDir, { recursive: true });

    // If already accessible (e.g. via directory symlink), skip
    if (existsSync(symlinkPath)) {
      try {
        if (realpathSync(symlinkPath) === realpathSync(targetFile)) {
          console.log(`Credentials already accessible at ${symlinkPath}`);
          return;
        }
      } catch {}
    }

    // Ensure onboarding is bypassed
    const dotClaudeJson = join(home, '.claude.json');
    if (!existsSync(dotClaudeJson)) {
      writeFileSync(dotClaudeJson, JSON.stringify({ hasCompletedOnboarding: true }));
    }

    // Remove existing symlink/file if present
    try { unlinkSync(symlinkPath); } catch {}

    // Create symlink
    symlinkSync(targetFile, symlinkPath);
    console.log(`Symlinked ${symlinkPath} -> ${targetFile}`);
  }

  // --- Credentials reading ---

  private readCredentials(): ClaudeCredentials | null {
    if (!this.storedAuth) return null;
    try {
      const credFile = join(this.storedAuth.claudeDir, '.credentials.json');
      const raw = readFileSync(credFile, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Get the raw OAuth access token from the credentials file, or env var fallback.
  getAccessToken(): string | null {
    if (this.storedAuth) {
      try {
        const credFile = join(this.storedAuth.claudeDir, '.credentials.json');
        const raw = readFileSync(credFile, 'utf-8');
        const creds = JSON.parse(raw);
        return creds.claudeAiOauth?.accessToken || creds.accessToken || null;
      } catch {
        return null;
      }
    }

    return process.env.CLAUDE_CODE_OAUTH_TOKEN || null;
  }

  // --- Token expiry checks ---

  isTokenExpired(): boolean {
    const creds = this.readCredentials();
    const expiresAt = creds?.claudeAiOauth?.expiresAt;
    if (!expiresAt) return false; // Unknown expiry — assume valid
    return Date.now() >= expiresAt - REFRESH_BUFFER_MS;
  }

  getTokenStatus(): TokenStatus {
    const creds = this.readCredentials();
    const expiresAt = creds?.claudeAiOauth?.expiresAt;
    if (!expiresAt) return 'unknown';
    const now = Date.now();
    if (now >= expiresAt) return 'expired';
    if (now >= expiresAt - REFRESH_BUFFER_MS) return 'expiring_soon';
    return 'valid';
  }

  // --- Token refresh ---

  onTokenRefreshed(listener: (newToken: string) => void): void {
    this.refreshedListeners.push(listener);
  }

  onTokenRefreshFailed(listener: (error: string) => void): void {
    this.refreshFailedListeners.push(listener);
  }

  // Ensure the token is fresh before use. Auto-refreshes if expired.
  async ensureFreshToken(): Promise<string | null> {
    if (!this.isTokenExpired()) {
      return this.getAccessToken();
    }
    return this.refreshToken();
  }

  // Attempt to refresh the OAuth token. Returns the new access token or null on failure.
  async refreshToken(): Promise<string | null> {
    // Serialize: if a refresh is already in-flight, piggyback on it
    if (this.refreshInProgress) {
      const success = await this.refreshInProgress;
      return success ? this.getAccessToken() : null;
    }

    // Cooldown guard
    if (Date.now() - this.lastRefreshAttempt < REFRESH_COOLDOWN_MS) {
      console.warn('[credentials] Refresh attempted too recently, skipping');
      return null;
    }

    this.lastRefreshAttempt = Date.now();

    this.refreshInProgress = this.doRefresh();
    try {
      const success = await this.refreshInProgress;
      return success ? this.getAccessToken() : null;
    } finally {
      this.refreshInProgress = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    const creds = this.readCredentials();
    const refreshToken = creds?.claudeAiOauth?.refreshToken;

    if (!refreshToken) {
      const msg = 'No refresh token available in .credentials.json';
      console.error(`[credentials] ${msg}`);
      for (const listener of this.refreshFailedListeners) listener(msg);
      return false;
    }

    console.log('[credentials] Attempting token refresh...');

    try {
      const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OAUTH_CLIENT_ID,
        }).toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const msg = `Token refresh failed (${response.status}): ${errorBody}`;
        console.error(`[credentials] ${msg}`);
        for (const listener of this.refreshFailedListeners) listener(msg);
        return false;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      this.writeRefreshedCredentials(creds!, data);

      const newToken = data.access_token;
      console.log('[credentials] Token refreshed successfully');

      for (const listener of this.refreshedListeners) {
        try { listener(newToken); } catch (err) {
          console.error('[credentials] Refresh listener error:', err);
        }
      }

      return true;
    } catch (err: any) {
      const msg = `Token refresh error: ${err.message}`;
      console.error(`[credentials] ${msg}`);
      for (const listener of this.refreshFailedListeners) listener(msg);
      return false;
    }
  }

  private writeRefreshedCredentials(
    _existing: ClaudeCredentials,
    oauthResponse: { access_token: string; refresh_token?: string; expires_in?: number },
  ): void {
    if (!this.storedAuth) return;

    const credFile = join(this.storedAuth.claudeDir, '.credentials.json');

    // Re-read the credentials file immediately before writing to avoid TOCTOU:
    // another process may have modified the file while the refresh request was in-flight.
    const freshCreds = this.readCredentials() ?? {};

    if (!freshCreds.claudeAiOauth) freshCreds.claudeAiOauth = {};
    freshCreds.claudeAiOauth.accessToken = oauthResponse.access_token;

    // Update refresh token if a new one was issued (rotation)
    if (oauthResponse.refresh_token) {
      freshCreds.claudeAiOauth.refreshToken = oauthResponse.refresh_token;
    }

    // Calculate and store expiry time (expiresAt is Unix ms)
    if (oauthResponse.expires_in) {
      freshCreds.claudeAiOauth.expiresAt = Date.now() + oauthResponse.expires_in * 1000;
    }

    writeFileSync(credFile, JSON.stringify(freshCreds, null, 2));
    console.log(`[credentials] Updated credentials file: ${credFile}`);
  }

  // --- Proactive refresh timer ---

  startProactiveRefresh(): void {
    this.refreshTimer = setInterval(() => {
      if (this.storedAuth && this.isTokenExpired()) {
        console.log('[credentials] Proactive refresh: token is expired or expiring soon');
        this.refreshToken().then((token) => {
          if (!token) {
            // Refresh failed — schedule a retry right after the cooldown expires
            console.warn('[credentials] Proactive refresh failed, retrying after cooldown...');
            setTimeout(() => {
              this.refreshToken().catch((err) => {
                console.error('[credentials] Proactive refresh retry failed:', err);
              });
            }, REFRESH_COOLDOWN_MS);
          }
        }).catch((err) => {
          console.error('[credentials] Proactive refresh failed:', err);
        });
      }
    }, PROACTIVE_CHECK_INTERVAL_MS);
  }

  stopProactiveRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // --- Status & display ---

  getStatus(): AuthStatusResponse {
    if (this.storedAuth) {
      const creds = this.readCredentials();
      let maskedToken: string | null = null;
      let tokenExpiresAt: string | null = null;

      const token = creds?.claudeAiOauth?.accessToken || creds?.accessToken || '';
      if (token) {
        maskedToken = token.slice(0, 8) + '...' + token.slice(-4);
      }

      const expiresAt = creds?.claudeAiOauth?.expiresAt;
      if (expiresAt) {
        tokenExpiresAt = new Date(expiresAt).toISOString();
      }

      return {
        method: 'oauth_credentials_file',
        credentialsPath: this.storedAuth.claudeDir,
        maskedToken,
        tokenExpiresAt,
        tokenStatus: this.getTokenStatus(),
      };
    }

    return {
      method: 'none',
      credentialsPath: null,
      maskedToken: null,
      tokenExpiresAt: null,
      tokenStatus: null,
    };
  }

  // Get the currently selected .claude directory path (for container volume mounts).
  getSelectedClaudeDir(): string | null {
    return this.storedAuth?.claudeDir ?? null;
  }

  // Clear stored credentials path and remove symlink.
  clear(): void {
    if (config.hostDrivePrefix) {
      try { unlinkSync(join(homedir(), '.claude', '.credentials.json')); } catch {}
    }
    this.storedAuth = null;
    this.save();
  }
}
