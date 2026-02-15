import { readFileSync, writeFileSync, unlinkSync, symlinkSync, existsSync, readdirSync, mkdirSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { config } from '../config.js';
import type { AuthStatusResponse } from '@clawd/shared';

interface StoredAuth {
  claudeDir: string;
}

export class CredentialStore {
  private storedAuth: StoredAuth | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(config.claudeAuthPath, 'utf-8');
      this.storedAuth = JSON.parse(raw);
    } catch {
      this.storedAuth = null;
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

  // Get current auth status for display.
  getStatus(): AuthStatusResponse {
    if (this.storedAuth) {
      const credFile = join(this.storedAuth.claudeDir, '.credentials.json');
      let maskedToken: string | null = null;

      try {
        const raw = readFileSync(credFile, 'utf-8');
        const creds = JSON.parse(raw);
        const token = creds.claudeAiOauth?.accessToken || creds.accessToken || '';
        if (token) {
          maskedToken = token.slice(0, 8) + '...' + token.slice(-4);
        }
      } catch {}

      return {
        method: 'oauth_credentials_file',
        credentialsPath: this.storedAuth.claudeDir,
        maskedToken,
      };
    }

    return {
      method: 'none',
      credentialsPath: null,
      maskedToken: null,
    };
  }

  // Get the raw OAuth access token from the credentials file.
  getAccessToken(): string | null {
    if (!this.storedAuth) return null;

    try {
      const credFile = join(this.storedAuth.claudeDir, '.credentials.json');
      const raw = readFileSync(credFile, 'utf-8');
      const creds = JSON.parse(raw);
      return creds.claudeAiOauth?.accessToken || creds.accessToken || null;
    } catch {
      return null;
    }
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
