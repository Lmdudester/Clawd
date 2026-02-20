import { config } from '../config.js';
import type { SessionContainerConfig } from './container-manager.js';

export function buildContainerName(sessionId: string): string {
  return `clawd-session-${config.instanceId}-${sessionId}`;
}

export function buildContainerEnv(cfg: SessionContainerConfig): string[] {
  const env: string[] = [
    `SESSION_ID=${cfg.sessionId}`,
    `SESSION_TOKEN=${cfg.sessionToken}`,
    `MASTER_WS_URL=ws://${config.masterHostname}:${config.port}/internal/session`,
    `PERMISSION_MODE=${cfg.permissionMode || 'normal'}`,
    `GIT_REPO_URL=${cfg.repoUrl}`,
    `GIT_BRANCH=${cfg.branch}`,
    `ANTHROPIC_MODEL=opus`,
  ];

  if (cfg.githubToken) env.push(`GITHUB_TOKEN=${cfg.githubToken}`);
  if (cfg.gitUserName) env.push(`GIT_USER_NAME=${cfg.gitUserName}`);
  if (cfg.gitUserEmail) env.push(`GIT_USER_EMAIL=${cfg.gitUserEmail}`);
  if (cfg.oauthToken) env.push(`CLAUDE_CODE_OAUTH_TOKEN=${cfg.oauthToken}`);

  if (cfg.dockerAccess) {
    env.push('DOCKER_HOST=unix:///var/run/docker.sock');
  }

  if (cfg.managerMode) {
    env.push('MANAGER_MODE=true');
    if (cfg.managerApiToken) env.push(`MANAGER_API_TOKEN=${cfg.managerApiToken}`);
    env.push(`MASTER_HTTP_URL=http://${config.masterHostname}:${config.port}`);
  }

  return env;
}

export function buildContainerBinds(cfg: SessionContainerConfig): string[] {
  const binds: string[] = [];
  if (cfg.claudeDir) {
    binds.push(`${cfg.claudeDir}/.credentials.json:/home/node/.claude/.credentials.json:ro`);
  }
  if (cfg.dockerAccess) {
    binds.push('/var/run/docker.sock:/var/run/docker.sock');
  }
  return binds;
}
