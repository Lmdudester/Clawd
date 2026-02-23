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
import { ContainerManager } from './sessions/container-manager.js';
import { CredentialStore } from './settings/credential-store.js';
import { ProjectRepoStore } from './settings/project-repos.js';
import { Notifier } from './notifications/notifier.js';
import { setupWebSocket } from './ws/handler.js';
import { setupInternalWebSocket } from './ws/internal-handler.js';
import { config } from './config.js';
import { SessionStore } from './sessions/session-store.js';
import { setManagerTokenValidator } from './auth/middleware.js';
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
credentialStore.startProactiveRefresh();
const projectRepoStore = new ProjectRepoStore();

// Log auth status at startup
const authStatus = credentialStore.getStatus();
switch (authStatus.method) {
  case 'oauth_credentials_file':
    console.log(`Auth: OAuth credentials file (${authStatus.credentialsPath})`);
    if (authStatus.maskedToken) console.log(`  Token: ${authStatus.maskedToken}`);
    if (authStatus.tokenStatus) console.log(`  Token status: ${authStatus.tokenStatus}`);
    if (authStatus.tokenExpiresAt) console.log(`  Expires: ${authStatus.tokenExpiresAt}`);
    break;
  case 'none':
    console.warn('Auth: No OAuth credentials configured — configure via Settings');
    break;
}

const notifier = new Notifier();
if (notifier.enabled) {
  console.log(`Notifications: enabled via ntfy (topic: ${config.ntfyTopic})`);
} else {
  console.log('Notifications: disabled (set NTFY_TOPIC to enable)');
}

// Load persisted session state (including stable internalSecret)
const sessionStore = new SessionStore();
const persistedState = sessionStore.load();
if (persistedState) {
  // Restore the internal secret so surviving containers can reconnect
  config.internalSecret = persistedState.internalSecret;
  console.log('[startup] Restored internal secret from session store');
} else {
  // First run — persist the newly generated secret
  sessionStore.save({ sessions: [], internalSecret: config.internalSecret });
  console.log('[startup] Persisted new internal secret to session store');
}

// Collect restored session IDs to prevent pruning their containers
const restoredSessionIds = new Set<string>();
if (persistedState) {
  for (const s of persistedState.sessions) {
    if (s.info.status !== 'terminated' && s.info.status !== 'error') {
      restoredSessionIds.add(s.info.id);
    }
  }
}

// Initialize container manager
const containerManager = new ContainerManager();

const sessionManager = new SessionManager(credentialStore, containerManager, sessionStore);

// Allow manager sessions to authenticate via their API tokens
setManagerTokenValidator((token) => sessionManager.validateManagerToken(token));

const app = createApp(sessionManager, credentialStore, projectRepoStore);
const server = createServer(app);

// Set up WebSocket servers (both noServer mode)
const { wss: clientWss } = setupWebSocket(server, sessionManager, credentialStore, notifier);
const internalWss = setupInternalWebSocket(sessionManager);

// Route HTTP upgrade requests to the correct WebSocket server
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/ws') {
    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
  } else if (pathname === '/internal/session') {
    // Validate shared secret before allowing the upgrade
    const secret = url.searchParams.get('secret');
    if (secret !== config.internalSecret) {
      console.warn('[internal-ws] Rejected upgrade: invalid or missing secret');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    internalWss.handleUpgrade(req, socket, head, (ws) => internalWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// Graceful shutdown — persist state then clean up containers and network
const shutdown = async () => {
  console.log('\nShutting down...');
  sessionManager.persistAll();
  console.log('[shutdown] Session state persisted');
  await containerManager.shutdown();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Initialize container manager before accepting requests
containerManager.initialize(restoredSessionIds.size > 0 ? restoredSessionIds : undefined).then(async () => {
  console.log('[containers] Container manager initialized');

  // Restore sessions from persisted state
  if (restoredSessionIds.size > 0) {
    const restored = sessionManager.restoreSessions(persistedState);

    // Match restored sessions to still-running containers
    const runningContainers = await containerManager.findRunningContainers();
    for (const sessionId of restored) {
      const containerId = runningContainers.get(sessionId);
      if (containerId) {
        containerManager.reattachContainer(sessionId, containerId);
      } else {
        // Container is gone — mark session as error
        console.warn(`[startup] Container for session ${sessionId} is no longer running`);
        sessionManager.markOrphaned(sessionId);
      }
    }
  }

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
}).catch((err) => {
  console.error('[containers] Failed to initialize container manager:', err.message);
  console.warn('[containers] Session containers will not work until Docker is available');
});
