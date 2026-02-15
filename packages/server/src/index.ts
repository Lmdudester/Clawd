// Load .env from project root before anything else
import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv({ path: resolve(__dirname, '../../../.env') });

// Clear CLAUDECODE to allow spawning Claude Code child processes
delete process.env.CLAUDECODE;

import { createServer } from 'http';
import { createApp } from './app.js';
import { SessionManager } from './sessions/session-manager.js';
import { CredentialStore } from './settings/credential-store.js';
import { ProjectFolderStore } from './settings/project-folders.js';
import { SmsNotifier } from './sms/sms-notifier.js';
import { setupWebSocket } from './ws/handler.js';
import { config } from './config.js';
import { networkInterfaces } from 'os';

// Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const credentialStore = new CredentialStore();
const projectFolderStore = new ProjectFolderStore();

// Log auth status at startup
const authStatus = credentialStore.getStatus();
switch (authStatus.method) {
  case 'oauth_credentials_file':
    console.log(`Auth: OAuth credentials file (${authStatus.credentialsPath})`);
    if (authStatus.maskedToken) console.log(`  Token: ${authStatus.maskedToken}`);
    break;
  case 'env_fallback':
    console.log(`Auth: ANTHROPIC_API_KEY env var (${authStatus.maskedToken})`);
    break;
  case 'none':
    console.warn('Auth: No API key or OAuth credentials configured — configure via Settings');
    break;
}

const smsNotifier = new SmsNotifier();
if (smsNotifier.enabled) {
  console.log(`Notifications: enabled via ntfy (topic: ${config.ntfyTopic})`);
} else {
  console.log('Notifications: disabled (set NTFY_TOPIC to enable)');
}

const sessionManager = new SessionManager(credentialStore);
const app = createApp(sessionManager, credentialStore, projectFolderStore);
const server = createServer(app);

setupWebSocket(server, sessionManager, smsNotifier);

server.listen(config.port, config.host, () => {
  console.log(`\n  Clawd server running on http://${config.host}:${config.port}`);

  // Show LAN URLs
  if (config.host === '0.0.0.0') {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  LAN: http://${net.address}:${config.port}`);
        }
      }
    }
  }

  console.log('');
});
