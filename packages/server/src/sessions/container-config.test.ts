import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    instanceId: 'test-instance',
    masterHostname: 'clawd-test',
    port: 3050,
  },
}));

import { buildContainerName, buildContainerEnv, buildContainerBinds } from './container-config.js';
import type { SessionContainerConfig } from './container-manager.js';

function baseCfg(overrides: Partial<SessionContainerConfig> = {}): SessionContainerConfig {
  return {
    sessionId: 'session-123',
    sessionToken: 'token-abc',
    repoUrl: 'https://github.com/test/repo',
    branch: 'main',
    claudeDir: '',
    ...overrides,
  };
}

describe('buildContainerName', () => {
  it('includes instance ID and session ID', () => {
    expect(buildContainerName('session-123')).toBe('clawd-session-test-instance-session-123');
  });
});

describe('buildContainerEnv', () => {
  it('includes required environment variables', () => {
    const env = buildContainerEnv(baseCfg());
    expect(env).toContain('SESSION_ID=session-123');
    expect(env).toContain('GIT_REPO_URL=https://github.com/test/repo');
    expect(env).toContain('GIT_BRANCH=main');
    expect(env).toContain('PERMISSION_MODE=normal');
  });

  it('does not include secrets as environment variables', () => {
    const env = buildContainerEnv(baseCfg({
      githubToken: 'ghp_abc123',
      oauthToken: 'oauth-xyz',
    }));
    expect(env.some(e => e.startsWith('SESSION_TOKEN='))).toBe(false);
    expect(env.some(e => e.startsWith('MASTER_WS_URL='))).toBe(false);
    expect(env.some(e => e.startsWith('GITHUB_TOKEN='))).toBe(false);
    expect(env.some(e => e.startsWith('CLAUDE_CODE_OAUTH_TOKEN='))).toBe(false);
  });

  it('includes DOCKER_HOST when dockerAccess is true', () => {
    const env = buildContainerEnv(baseCfg({ dockerAccess: true }));
    expect(env).toContain('DOCKER_HOST=unix:///var/run/docker.sock');
  });

  it('uses specified permissionMode', () => {
    const env = buildContainerEnv(baseCfg({ permissionMode: 'dangerous' }));
    expect(env).toContain('PERMISSION_MODE=dangerous');
  });

  it('defaults permissionMode to normal', () => {
    const env = buildContainerEnv(baseCfg({ permissionMode: undefined }));
    expect(env).toContain('PERMISSION_MODE=normal');
  });

  it('includes git user info when present', () => {
    const env = buildContainerEnv(baseCfg({
      gitUserName: 'Alice',
      gitUserEmail: 'alice@example.com',
    }));
    expect(env).toContain('GIT_USER_NAME=Alice');
    expect(env).toContain('GIT_USER_EMAIL=alice@example.com');
  });
});

describe('buildContainerBinds', () => {
  it('includes credentials mount when claudeDir is set', () => {
    const binds = buildContainerBinds(baseCfg({ claudeDir: '/home/user/.claude' }));
    expect(binds).toContain(
      '/home/user/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro'
    );
  });

  it('does not include secrets in binds (secrets use volume subpath mount)', () => {
    const binds = buildContainerBinds(baseCfg());
    expect(binds.some(b => b.includes('/run/secrets'))).toBe(false);
  });

  it('includes docker socket when dockerAccess is true', () => {
    const binds = buildContainerBinds(baseCfg({ dockerAccess: true }));
    expect(binds).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  it('returns empty array when no binds needed', () => {
    const binds = buildContainerBinds(baseCfg({ claudeDir: '', dockerAccess: false }));
    expect(binds).toEqual([]);
  });
});
