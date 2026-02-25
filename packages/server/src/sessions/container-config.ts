import { config } from '../config.js';
import type { SessionContainerConfig } from './container-manager.js';

export function buildContainerName(sessionId: string): string {
  return `clawd-session-${config.instanceId}-${sessionId}`;
}

/**
 * Build the non-secret environment variables for a session container.
 * Secrets (SESSION_TOKEN, MASTER_WS_URL, CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN,
 * MANAGER_API_TOKEN) are written to temp files and bind-mounted at /run/secrets:ro
 * by ContainerManager — they are NOT passed as env vars.
 */
export function buildContainerEnv(cfg: SessionContainerConfig): string[] {
  const env: string[] = [
    `SESSION_ID=${cfg.sessionId}`,
    `PERMISSION_MODE=${cfg.permissionMode || 'normal'}`,
    `GIT_REPO_URL=${cfg.repoUrl}`,
    `GIT_BRANCH=${cfg.branch}`,
    `ANTHROPIC_MODEL=opus`,
  ];

  if (cfg.gitUserName) env.push(`GIT_USER_NAME=${cfg.gitUserName}`);
  if (cfg.gitUserEmail) env.push(`GIT_USER_EMAIL=${cfg.gitUserEmail}`);

  if (cfg.dockerAccess) {
    env.push('DOCKER_HOST=unix:///var/run/docker.sock');
  }

  if (cfg.managerMode) {
    env.push('MANAGER_MODE=true');
    env.push(`MASTER_HTTP_URL=http://${config.masterHostname}:${config.port}`);
  }

  return env;
}

export function buildContainerBinds(cfg: SessionContainerConfig): string[] {
  const binds: string[] = [];
  if (cfg.claudeDir) {
    binds.push(`${cfg.claudeDir}/.credentials.json:/home/node/.claude/.credentials.json:ro`);
  }
  // Secrets are mounted via Docker volume subpath in Mounts, not Binds
  if (cfg.dockerAccess) {
    binds.push('/var/run/docker.sock:/var/run/docker.sock');
  }
  return binds;
}
