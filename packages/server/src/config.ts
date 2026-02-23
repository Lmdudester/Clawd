import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../..');

export const config = {
  port: parseInt(process.env.CLAWD_PORT || '3050'),
  host: process.env.CLAWD_HOST || 'localhost',

  // Shared secret for authenticating internal WebSocket connections from session containers.
  // Initialized with a random value; overwritten at startup with persisted value if available.
  internalSecret: randomBytes(32).toString('hex'),
  hostDrivePrefix: process.env.HOST_DRIVE_PREFIX || '',
  jwtSecret: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
  credentialsPath: process.env.CREDENTIALS_PATH || resolve(projectRoot, 'credentials.json'),
  claudeAuthPath: resolve(projectRoot, 'claude-auth.json'),
  get ntfyTopic() { return process.env.NTFY_TOPIC || ''; },
  get ntfyServer() { return process.env.NTFY_SERVER || 'https://ntfy.sh'; },

  // Instance identification (prevents cross-instance container conflicts)
  instanceId: process.env.CLAWD_INSTANCE_ID || 'production',

  // Hostname that session containers use to reach this master (on the Docker network)
  masterHostname: process.env.CLAWD_MASTER_HOSTNAME || 'clawd',

  // Docker container management
  sessionImage: process.env.CLAWD_SESSION_IMAGE || 'clawd-session:latest',
  // Include instanceId in the default network name to avoid collisions when
  // multiple Clawd instances run on the same Docker host.
  networkName: process.env.CLAWD_NETWORK ||
    `clawd-network-${process.env.CLAWD_INSTANCE_ID || 'production'}`,
  sessionMemoryLimit: parseInt(process.env.SESSION_MEMORY_LIMIT || String(4 * 1024 * 1024 * 1024)), // 4GB
  sessionCpuShares: parseInt(process.env.SESSION_CPU_SHARES || '512'),
  sessionPidsLimit: parseInt(process.env.SESSION_PIDS_LIMIT || '256'),

  // Maximum number of concurrent sessions (0 = unlimited)
  maxSessions: parseInt(process.env.MAX_SESSIONS || '50'),

  // Project repos config file path
  projectReposPath: process.env.PROJECT_REPOS_PATH || resolve(projectRoot, 'project-repos.json'),

  // Session store file path (persists session state across restarts)
  sessionStorePath: process.env.SESSION_STORE_PATH || resolve(projectRoot, 'session-store.json'),
};

if (!process.env.JWT_SECRET) {
  console.warn('[config] WARNING: JWT_SECRET is not set. Using a random secret — all sessions will be invalidated on server restart. Set JWT_SECRET in your .env for persistent authentication.');
}
