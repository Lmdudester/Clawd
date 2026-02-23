import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { authRouter } from './routes/auth.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createUsageRoutes } from './routes/usage.js';
import { createRepoRoutes } from './routes/repos.js';
import { createSkillRoutes } from './routes/skills.js';
import { config } from './config.js';
import type { SessionManager } from './sessions/session-manager.js';
import type { CredentialStore } from './settings/credential-store.js';
import type { ProjectRepoStore } from './settings/project-repos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(sessionManager: SessionManager, credentialStore: CredentialStore, projectRepoStore: ProjectRepoStore) {
  const app = express();

  app.use(express.json());

  app.use(cors({
    origin: config.corsOrigins ?? false,
    credentials: true,
  }));

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/sessions', createSessionRoutes(sessionManager));
  app.use('/api/settings', createSettingsRoutes(credentialStore, projectRepoStore));
  app.use('/api/usage', createUsageRoutes(credentialStore));
  app.use('/api/repos', createRepoRoutes());
  app.use('/api/skills', createSkillRoutes());

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
