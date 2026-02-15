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
  vapidKeysPath: resolve(projectRoot, 'vapid-keys.json'),
};
