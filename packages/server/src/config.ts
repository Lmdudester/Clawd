import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../..');

export const config = {
  port: parseInt(process.env.CLAWD_PORT || '3050'),
  host: process.env.CLAWD_HOST || 'localhost',
  hostDrivePrefix: process.env.HOST_DRIVE_PREFIX || '',
  jwtSecret: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
  credentialsPath: process.env.CREDENTIALS_PATH || resolve(projectRoot, 'credentials.json'),
  claudeAuthPath: resolve(projectRoot, 'claude-auth.json'),
  get ntfyTopic() { return process.env.NTFY_TOPIC || ''; },
  get ntfyServer() { return process.env.NTFY_SERVER || 'https://ntfy.sh'; },

  // Instance identification (prevents cross-instance container conflicts)
  instanceId: process.env.CLAWD_INSTANCE_ID || 'production',

  // Docker container management
  sessionImage: process.env.CLAWD_SESSION_IMAGE || 'clawd-session:latest',
  networkName: process.env.CLAWD_NETWORK || 'clawd-network',
  sessionMemoryLimit: parseInt(process.env.SESSION_MEMORY_LIMIT || String(4 * 1024 * 1024 * 1024)), // 4GB
  sessionCpuShares: parseInt(process.env.SESSION_CPU_SHARES || '512'),
  sessionPidsLimit: parseInt(process.env.SESSION_PIDS_LIMIT || '256'),

  // Project repos config file path
  projectReposPath: process.env.PROJECT_REPOS_PATH || resolve(projectRoot, 'project-repos.json'),
};
