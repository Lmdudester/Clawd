import { Router } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import type { CredentialStore } from '../settings/credential-store.js';
import type { ProjectRepoStore } from '../settings/project-repos.js';
import type { SetCredentialsPathRequest, SetProjectReposRequest } from '@clawd/shared';

export function createSettingsRoutes(credentialStore: CredentialStore, projectRepoStore: ProjectRepoStore): Router {
  const router = Router();
  router.use(authMiddleware);

  // Get current auth status
  router.get('/auth', (req, res) => {
    res.json(credentialStore.getStatus());
  });

  // Discover credential files on the mounted drive
  router.get('/auth/discover', (req, res) => {
    const paths = credentialStore.discoverCredentialFiles();
    res.json({ paths });
  });

  // Set credentials path
  router.put('/auth', (req, res) => {
    const { credentialsPath } = req.body as SetCredentialsPathRequest;
    if (!credentialsPath) {
      res.status(400).json({ error: 'credentialsPath is required' });
      return;
    }

    if (credentialsPath.includes('\0') || credentialsPath.length > 500) {
      res.status(400).json({ error: 'Invalid credentials path' });
      return;
    }

    try {
      credentialStore.setCredentialsPath(credentialsPath);
      res.json(credentialStore.getStatus());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Clear credentials (revert to env fallback)
  router.delete('/auth', (req, res) => {
    credentialStore.clear();
    res.json(credentialStore.getStatus());
  });

  // Project Repos
  router.get('/repos', (req, res) => {
    res.json({ repos: projectRepoStore.getRepos() });
  });

  router.put('/repos', (req, res) => {
    const { repos } = req.body as SetProjectReposRequest;
    if (!Array.isArray(repos)) {
      res.status(400).json({ error: 'repos must be an array' });
      return;
    }
    projectRepoStore.setRepos(repos);
    res.json({ repos: projectRepoStore.getRepos() });
  });

  return router;
}
