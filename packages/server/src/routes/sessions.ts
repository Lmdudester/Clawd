import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../auth/middleware.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { CreateSessionRequest, SendMessageRequest, UpdateManagerStepRequest, ErrorResponse, ManagerStep } from '@clawd/shared';

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
    const { name, repoUrl, branch, dockerAccess, managerMode } = req.body as CreateSessionRequest;

    if (!name || !repoUrl || !branch) {
      const error: ErrorResponse = { error: 'Name, repoUrl, and branch are required' };
      res.status(400).json(error);
      return;
    }

    try {
      const session = await sessionManager.createSession(name, repoUrl, branch, !!dockerAccess, !!managerMode);

      // Auto-link child to parent manager if created via manager API token
      if (req.managerApiToken) {
        const managerId = sessionManager.findManagerByToken(req.managerApiToken);
        if (managerId) {
          sessionManager.trackChildSession(managerId, session.id);
        }
      }

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

  // Get session messages
  router.get('/:id/messages', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ messages: sessionManager.getMessages(req.params.id) });
  });

  // Send a message/prompt to a session (used by manager sessions)
  router.post('/:id/message', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { content } = req.body as SendMessageRequest;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    sessionManager.sendMessage(req.params.id, content);
    res.json({ ok: true });
  });

  // Update session settings (used by manager sessions)
  router.post('/:id/settings', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    sessionManager.updateSessionSettings(req.params.id, req.body);
    res.json({ ok: true });
  });

  // Update manager step
  router.post('/:id/manager-step', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!session.info.isManager) {
      res.status(400).json({ error: 'Not a manager session' });
      return;
    }

    const { step } = req.body as UpdateManagerStepRequest;
    const validSteps: ManagerStep[] = ['idle', 'exploring', 'fixing', 'testing', 'merging'];
    if (!step || !validSteps.includes(step)) {
      res.status(400).json({ error: `Invalid step. Must be one of: ${validSteps.join(', ')}` });
      return;
    }

    sessionManager.updateManagerStep(req.params.id, step);
    res.json({ ok: true });
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
