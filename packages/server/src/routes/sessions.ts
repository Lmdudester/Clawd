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
  router.post('/', (req: AuthRequest, res) => {
    const { name, cwd } = req.body as CreateSessionRequest;

    if (!name || !cwd) {
      const error: ErrorResponse = { error: 'Name and cwd are required' };
      res.status(400).json(error);
      return;
    }

    const session = sessionManager.createSession(name, cwd);
    res.status(201).json({ session });
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
  router.delete('/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    sessionManager.deleteSession(req.params.id);
    res.status(204).end();
  });

  return router;
}
