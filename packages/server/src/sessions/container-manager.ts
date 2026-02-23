// Docker container lifecycle management for session containers.
// Uses dockerode to create, start, stop, and remove session containers.

import Docker from 'dockerode';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
  dockerAccess?: boolean;
  managerMode?: boolean;
  managerApiToken?: string;
}

export class ContainerManager {
  private docker: Docker;
  private containers = new Map<string, string>(); // sessionId -> containerId
  private secretsDirs = new Map<string, string>(); // sessionId -> temp secrets dir path

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async initialize(preserveSessionIds?: Set<string>): Promise<void> {
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

    // Prune stale session containers from previous runs (skip preserved sessions)
    await this.pruneStaleContainers(preserveSessionIds);
  }

  private async pruneStaleContainers(preserveSessionIds?: Set<string>): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: [
          'clawd.session=true',
          `clawd.instance.id=${config.instanceId}`,
        ] },
      });

      for (const container of containers) {
        const sessionId = container.Labels?.['clawd.session.id'];
        if (sessionId && preserveSessionIds?.has(sessionId)) {
          console.log(`[containers] Preserving restored container: ${container.Names?.[0]} (session: ${sessionId})`);
          continue;
        }

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

    // Clean up orphaned secret directories from previous runs
    try {
      const tmp = tmpdir();
      const entries = readdirSync(tmp);
      for (const entry of entries) {
        if (!entry.startsWith('clawd-secrets-')) continue;
        // Extract session ID from dir name: clawd-secrets-{sessionId}-{random}
        const match = entry.match(/^clawd-secrets-(.+)-[A-Za-z0-9]{6}$/);
        const sessionId = match?.[1];
        if (sessionId && preserveSessionIds?.has(sessionId)) continue;
        try {
          rmSync(join(tmp, entry), { recursive: true, force: true });
          console.log(`[containers] Cleaned up orphaned secrets dir: ${entry}`);
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[containers] Failed to clean up orphaned secret dirs: ${err.message}`);
    }
  }

  /**
   * Find all running session containers for this instance.
   * Returns a map of sessionId -> containerId.
   */
  async findRunningContainers(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const containers = await this.docker.listContainers({
        filters: {
          label: [
            'clawd.session=true',
            `clawd.instance.id=${config.instanceId}`,
          ],
          status: ['running'],
        },
      });

      for (const container of containers) {
        const sessionId = container.Labels?.['clawd.session.id'];
        if (sessionId) {
          result.set(sessionId, container.Id);
        }
      }
    } catch (err: any) {
      console.warn(`[containers] Failed to find running containers: ${err.message}`);
    }
    return result;
  }

  /** Register an existing running container without creating/starting it. */
  reattachContainer(sessionId: string, containerId: string): void {
    this.containers.set(sessionId, containerId);
    console.log(`[containers] Re-attached container for session ${sessionId} (${containerId.slice(0, 12)})`);
  }

  async createSessionContainer(cfg: SessionContainerConfig): Promise<string> {
    const containerName = `clawd-session-${config.instanceId}-${cfg.sessionId}`;
    console.log(`[containers] Creating container: ${containerName}`);

    // Write secrets to temp files instead of passing as env vars
    const secretsDir = mkdtempSync(join(tmpdir(), `clawd-secrets-${cfg.sessionId}-`));
    writeFileSync(join(secretsDir, 'session-token'), cfg.sessionToken, { mode: 0o644 });
    writeFileSync(
      join(secretsDir, 'master-ws-url'),
      `ws://${config.masterHostname}:${config.port}/internal/session?secret=${config.internalSecret}`,
      { mode: 0o644 },
    );
    if (cfg.oauthToken) writeFileSync(join(secretsDir, 'oauth-token'), cfg.oauthToken, { mode: 0o644 });
    if (cfg.githubToken) writeFileSync(join(secretsDir, 'github-token'), cfg.githubToken, { mode: 0o644 });
    if (cfg.managerApiToken) writeFileSync(join(secretsDir, 'manager-api-token'), cfg.managerApiToken, { mode: 0o644 });
    this.secretsDirs.set(cfg.sessionId, secretsDir);

    // Build environment variables (non-secret only)
    const env: string[] = [
      `SESSION_ID=${cfg.sessionId}`,
      `PERMISSION_MODE=${cfg.permissionMode || 'normal'}`,
      `GIT_REPO_URL=${cfg.repoUrl}`,
      `GIT_BRANCH=${cfg.branch}`,
      `ANTHROPIC_MODEL=opus`,
    ];

    if (cfg.gitUserName) env.push(`GIT_USER_NAME=${cfg.gitUserName}`);
    if (cfg.gitUserEmail) env.push(`GIT_USER_EMAIL=${cfg.gitUserEmail}`);

    // Manager mode env vars
    if (cfg.managerMode) {
      env.push('MANAGER_MODE=true');
      env.push(`MASTER_HTTP_URL=http://${config.masterHostname}:${config.port}`);
    }

    // Build volume binds — mount only the credentials file, not the whole .claude dir,
    // so the SDK can still create writable dirs like .claude/debug/
    const binds: string[] = [];
    if (cfg.claudeDir) {
      binds.push(`${cfg.claudeDir}/.credentials.json:/home/node/.claude/.credentials.json:ro`);
    }

    // Mount secrets directory read-only
    binds.push(`${secretsDir}:/run/secrets:ro`);

    // Mount Docker socket for sessions that need container management
    if (cfg.dockerAccess) {
      console.warn(`[containers] WARNING: Creating session ${cfg.sessionId} with Docker socket access — container will have host Docker control`);
      binds.push('/var/run/docker.sock:/var/run/docker.sock');
      env.push('DOCKER_HOST=unix:///var/run/docker.sock');
    }

    const container = await this.docker.createContainer({
      Image: config.sessionImage,
      name: containerName,
      Env: env,
      Labels: {
        'clawd.session': 'true',
        'clawd.session.id': cfg.sessionId,
        'clawd.instance.id': config.instanceId,
      },
      HostConfig: {
        Binds: binds.length > 0 ? binds : undefined,
        Memory: config.sessionMemoryLimit,
        CpuShares: config.sessionCpuShares,
        PidsLimit: config.sessionPidsLimit,
        NetworkMode: config.networkName,
        ...(cfg.dockerAccess ? {
          SecurityOpt: ['no-new-privileges:true'],
          CapDrop: ['ALL'],
        } : {}),
      },
    });

    try {
      await container.start();
    } catch (err) {
      // Clean up the created container and secrets before propagating the error
      this.cleanupSecrets(cfg.sessionId);
      try {
        await container.remove({ force: true });
      } catch {
        // Ignore removal errors
      }
      throw err;
    }
    this.containers.set(cfg.sessionId, container.id);

    console.log(`[containers] Container started: ${containerName} (${container.id.slice(0, 12)})`);
    return container.id;
  }

  private cleanupSecrets(sessionId: string): void {
    const dir = this.secretsDirs.get(sessionId);
    if (dir) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      this.secretsDirs.delete(sessionId);
    }
  }

  async stopAndRemove(sessionId: string): Promise<void> {
    // Clean up any test Clawd instances spawned by this session
    await this.cleanupTestInstances(sessionId);

    const containerId = this.containers.get(sessionId);
    if (!containerId) return;

    try {
      const container = this.docker.getContainer(containerId);
      try {
        await container.stop({ t: 2 });
      } catch {
        // May already be stopped
      }
      await container.remove({ force: true });
      console.log(`[containers] Removed container for session ${sessionId}`);
    } catch (err: any) {
      console.warn(`[containers] Failed to remove container for session ${sessionId}: ${err.message}`);
    }

    this.cleanupSecrets(sessionId);
    this.containers.delete(sessionId);
  }

  /** Remove test Clawd master containers spawned by a given session. */
  private async cleanupTestInstances(ownerSessionId: string): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: [`clawd.test-instance.owner=${ownerSessionId}`] },
      });

      for (const info of containers) {
        const c = this.docker.getContainer(info.Id);
        try {
          if (info.State === 'running') {
            console.log(`[containers] Stopping test instance: ${info.Names?.[0]}`);
            await c.stop({ t: 5 });
          }
          await c.remove({ force: true });
          console.log(`[containers] Removed test instance: ${info.Names?.[0]}`);
        } catch (err: any) {
          console.warn(`[containers] Failed to cleanup test instance: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`[containers] Failed to list test instances for session ${ownerSessionId}: ${err.message}`);
    }
  }

  async shutdown(): Promise<void> {
    console.log('[containers] Shutting down container manager...');

    // Stop and remove all tracked session containers
    const sessionIds = Array.from(this.containers.keys());
    for (const sessionId of sessionIds) {
      await this.stopAndRemove(sessionId);
    }

    // Remove the Docker network
    try {
      const network = this.docker.getNetwork(config.networkName);
      await network.remove();
      console.log(`[containers] Removed network "${config.networkName}"`);
    } catch (err: any) {
      console.warn(`[containers] Failed to remove network "${config.networkName}": ${err.message}`);
    }
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
