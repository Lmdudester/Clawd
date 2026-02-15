import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { authRouter } from './routes/auth.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createUsageRoutes } from './routes/usage.js';
import { createPushRoutes } from './routes/push.js';
import type { SessionManager } from './sessions/session-manager.js';
import type { CredentialStore } from './settings/credential-store.js';
import type { ProjectFolderStore } from './settings/project-folders.js';
import type { PushManager } from './push/push-manager.js';
import type { VapidStore } from './push/vapid-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(sessionManager: SessionManager, credentialStore: CredentialStore, projectFolderStore: ProjectFolderStore, pushManager: PushManager, vapidStore: VapidStore) {
  const app = express();

  app.use(express.json());

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/sessions', createSessionRoutes(sessionManager));
  app.use('/api/settings', createSettingsRoutes(credentialStore, projectFolderStore));
  app.use('/api/usage', createUsageRoutes(credentialStore));
  app.use('/api/push', createPushRoutes(pushManager, vapidStore));

  // Serve static client build in production
  const clientDist = join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));

  // SPA fallback: serve index.html for all non-API routes
  app.get(/^\/(?!api|ws).*/, (req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });

  // Error-handling middleware (must have 4 params)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`Express error on ${req.method} ${req.path}:`, err);
    res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
  });

  return app;
}
