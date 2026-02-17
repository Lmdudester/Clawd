import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../auth/middleware.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { CreateSessionRequest, ErrorResponse } from '@clawd/shared';

export function createSessionRoutes(sessionManager: SessionManager): Router {
  const router = Router();
  router.use(authMiddleware);

  // List all sessions
  router.get('/', (req, res) => {
    const sessions = sessionManager.getSessions();
    res.json({ sessions });
  });

  // Create a new session
  router.post('/', async (req: AuthRequest, res) => {
    const { name, repoUrl, branch, dockerAccess } = req.body as CreateSessionRequest;

    if (!name || !repoUrl || !branch) {
      const error: ErrorResponse = { error: 'Name, repoUrl, and branch are required' };
      res.status(400).json(error);
      return;
    }

    try {
      const session = await sessionManager.createSession(name, repoUrl, branch, !!dockerAccess);
      res.status(201).json({ session });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create session' });
    }
  });

  // Get session details
  router.get('/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      session: session.info,
      messages: sessionManager.getMessages(req.params.id),
    });
  });

  // Delete (terminate) session
  router.delete('/:id', async (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await sessionManager.deleteSession(req.params.id);
    res.status(204).end();
  });

  return router;
}
