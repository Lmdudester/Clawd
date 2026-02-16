// Docker container lifecycle management for session containers.
// Uses dockerode to create, start, stop, and remove session containers.

import Docker from 'dockerode';
import { config } from '../config.js';

export interface SessionContainerConfig {
  sessionId: string;
  sessionToken: string;
  repoUrl: string;
  branch: string;
  githubToken?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  claudeDir: string;
  oauthToken?: string;
  permissionMode?: string;
}

export class ContainerManager {
  private docker: Docker;
  private containers = new Map<string, string>(); // sessionId -> containerId

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async initialize(): Promise<void> {
    console.log('[containers] Initializing container manager...');

    // Ensure the bridge network exists
    try {
      await this.docker.getNetwork(config.networkName).inspect();
      console.log(`[containers] Network "${config.networkName}" exists`);
    } catch {
      console.log(`[containers] Creating network "${config.networkName}"...`);
      await this.docker.createNetwork({
        Name: config.networkName,
        Driver: 'bridge',
      });
    }

    // Prune stale session containers from previous runs
    await this.pruneStaleContainers();
  }

  private async pruneStaleContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: ['clawd.session=true'] },
      });

      for (const container of containers) {
        const c = this.docker.getContainer(container.Id);
        try {
          if (container.State === 'running') {
            console.log(`[containers] Stopping stale container: ${container.Names?.[0]}`);
            await c.stop({ t: 5 });
          }
          await c.remove({ force: true });
          console.log(`[containers] Removed stale container: ${container.Names?.[0]}`);
        } catch (err: any) {
          console.warn(`[containers] Failed to cleanup container: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`[containers] Failed to prune containers: ${err.message}`);
    }
  }

  async createSessionContainer(cfg: SessionContainerConfig): Promise<string> {
    const containerName = `clawd-session-${cfg.sessionId}`;
    console.log(`[containers] Creating container: ${containerName}`);

    // Build environment variables
    const env: string[] = [
      `SESSION_ID=${cfg.sessionId}`,
      `SESSION_TOKEN=${cfg.sessionToken}`,
      `MASTER_WS_URL=ws://clawd:${config.port}/internal/session`,
      `PERMISSION_MODE=${cfg.permissionMode || 'normal'}`,
      `GIT_REPO_URL=${cfg.repoUrl}`,
      `GIT_BRANCH=${cfg.branch}`,
    ];

    if (cfg.githubToken) env.push(`GITHUB_TOKEN=${cfg.githubToken}`);
    if (cfg.gitUserName) env.push(`GIT_USER_NAME=${cfg.gitUserName}`);
    if (cfg.gitUserEmail) env.push(`GIT_USER_EMAIL=${cfg.gitUserEmail}`);
    if (cfg.oauthToken) env.push(`CLAUDE_CODE_OAUTH_TOKEN=${cfg.oauthToken}`);

    // Build volume binds — mount only the credentials file, not the whole .claude dir,
    // so the SDK can still create writable dirs like .claude/debug/
    const binds: string[] = [];
    if (cfg.claudeDir) {
      binds.push(`${cfg.claudeDir}/.credentials.json:/home/node/.claude/.credentials.json:ro`);
    }

    const container = await this.docker.createContainer({
      Image: config.sessionImage,
      name: containerName,
      Env: env,
      Labels: {
        'clawd.session': 'true',
        'clawd.session.id': cfg.sessionId,
      },
      HostConfig: {
        Binds: binds.length > 0 ? binds : undefined,
        Memory: config.sessionMemoryLimit,
        CpuShares: config.sessionCpuShares,
        PidsLimit: config.sessionPidsLimit,
        NetworkMode: config.networkName,
      },
    });

    await container.start();
    this.containers.set(cfg.sessionId, container.id);

    console.log(`[containers] Container started: ${containerName} (${container.id.slice(0, 12)})`);
    return container.id;
  }

  async stopAndRemove(sessionId: string): Promise<void> {
    const containerId = this.containers.get(sessionId);
    if (!containerId) return;

    try {
      const container = this.docker.getContainer(containerId);
      try {
        await container.stop({ t: 10 });
      } catch {
        // May already be stopped
      }
      await container.remove({ force: true });
      console.log(`[containers] Removed container for session ${sessionId}`);
    } catch (err: any) {
      console.warn(`[containers] Failed to remove container for session ${sessionId}: ${err.message}`);
    }

    this.containers.delete(sessionId);
  }

  async getStatus(sessionId: string): Promise<'running' | 'stopped' | 'not_found'> {
    const containerId = this.containers.get(sessionId);
    if (!containerId) return 'not_found';

    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch {
      return 'not_found';
    }
  }
}
