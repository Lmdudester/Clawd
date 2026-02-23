import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../auth/middleware.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { CreateSessionRequest, SendMessageRequest, UpdateManagerStepRequest, ErrorResponse, ManagerStep } from '@clawd/shared';

/** Strip control characters and enforce length limit on session names. */
function sanitizeSessionName(name: string): string | null {
  const cleaned = name.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!cleaned || cleaned.length > 100) return null;
  return cleaned;
}

/** Check if the authenticated user owns the session (or is the managing manager). */
function isSessionOwner(req: AuthRequest, session: { info: { id: string; createdBy: string; managedBy?: string } }, sessionManager: SessionManager): boolean {
  if (req.managerApiToken) {
    // Resolve which manager session this token belongs to
    const managerId = sessionManager.findManagerByToken(req.managerApiToken);
    if (!managerId) return false;
    // Allow if: target is this manager itself, or a child managed by it
    return session.info.id === managerId || session.info.managedBy === managerId;
  }
  return req.user?.username === session.info.createdBy;
}

export function createSessionRoutes(sessionManager: SessionManager): Router {
  const router = Router();
  router.use(authMiddleware);

  // List sessions owned by the authenticated user
  router.get('/', (req: AuthRequest, res) => {
    const username = req.user?.username;
    const sessions = sessionManager.getSessions().filter(
      (s) => s.createdBy === username
    );
    res.json({ sessions });
  });

  // Create a new session
  router.post('/', async (req: AuthRequest, res) => {
    const { name, repoUrl, branch, dockerAccess, managerMode, permissionMode } = req.body as CreateSessionRequest;

    const sanitizedName = name ? sanitizeSessionName(name) : null;
    if (!sanitizedName || !repoUrl || !branch) {
      res.status(400).json({ error: 'Name (1-100 chars), repoUrl, and branch are required' } as ErrorResponse);
      return;
    }

    // Validate repo URL — only allow HTTPS GitHub URLs to prevent SSRF and argument injection
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repoUrl)) {
      res.status(400).json({ error: 'repoUrl must be a valid HTTPS GitHub URL (https://github.com/owner/repo)' });
      return;
    }

    // Validate branch name — reject anything starting with '-' (argument injection)
    // and only allow characters valid in git branch names
    if (/^-/.test(branch) || !/^[A-Za-z0-9_.\-/]+$/.test(branch)) {
      res.status(400).json({ error: 'branch contains invalid characters' });
      return;
    }

    try {
      // When created by a manager, inherit the manager's owner so children
      // appear in the same user's session list.
      let createdBy = req.user?.username ?? 'unknown';
      let managerId: string | null = null;
      if (req.managerApiToken) {
        managerId = sessionManager.findManagerByToken(req.managerApiToken);
        if (managerId) {
          const manager = sessionManager.getSession(managerId);
          if (manager) createdBy = manager.info.createdBy;
        }
      }

      // Validate and pass permission mode directly so it's set before the container starts
      const validatedMode = permissionMode && ['normal', 'auto_edits', 'dangerous', 'plan'].includes(permissionMode)
        ? permissionMode as import('@clawd/shared').PermissionMode
        : undefined;
      const session = await sessionManager.createSession(sanitizedName, repoUrl, branch, !!dockerAccess, !!managerMode, createdBy, validatedMode);

      // Auto-link child to parent manager
      if (managerId) {
        sessionManager.trackChildSession(managerId, session.id);
      }

      res.status(201).json({ session });
    } catch (err: any) {
      const status = err.message?.includes('Session limit reached') ? 429 : 500;
      res.status(status).json({ error: err.message || 'Failed to create session' });
    }
  });

  // Get session details
  router.get('/:id', (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      session: session.info,
      messages: sessionManager.getMessages(id),
      pendingApproval: session.pendingApproval ?? null,
      pendingQuestion: session.pendingQuestion ?? null,
    });
  });

  // Get session messages
  router.get('/:id/messages', (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ messages: sessionManager.getMessages(id) });
  });

  // Send a message/prompt to a session (used by manager sessions)
  router.post('/:id/message', (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }

    const { content } = req.body as SendMessageRequest;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    sessionManager.sendMessage(id, content);
    res.json({ ok: true });
  });

  // Update session settings (used by manager sessions)
  router.post('/:id/settings', (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }

    const settings = req.body;
    const validModes = ['normal', 'auto_edits', 'dangerous', 'plan'];
    if (settings.permissionMode !== undefined && !validModes.includes(settings.permissionMode)) {
      res.status(400).json({ error: `Invalid permissionMode. Must be one of: ${validModes.join(', ')}` });
      return;
    }

    sessionManager.updateSessionSettings(id, settings);
    res.json({ ok: true });
  });

  // Update manager step
  router.post('/:id/manager-step', (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }
    if (!session.info.isManager) {
      res.status(400).json({ error: 'Not a manager session' });
      return;
    }

    const { step } = req.body as UpdateManagerStepRequest;
    const validSteps: ManagerStep[] = ['idle', 'exploring', 'triaging', 'planning', 'reviewing', 'fixing', 'testing', 'merging'];
    if (!step || !validSteps.includes(step)) {
      res.status(400).json({ error: `Invalid step. Must be one of: ${validSteps.join(', ')}` });
      return;
    }

    sessionManager.updateManagerStep(id, step);
    res.json({ ok: true });
  });

  // Approve or deny a pending tool call
  router.post('/:id/approve', (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }

    const { approvalId, allow, message } = req.body;
    if (!approvalId || typeof allow !== 'boolean') {
      res.status(400).json({ error: 'approvalId and allow are required' });
      return;
    }

    sessionManager.approveToolUse(id, approvalId, allow, message);
    res.json({ ok: true });
  });

  // Pause a manager session (allows the manager to pause itself via API)
  router.post('/:id/pause', async (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }
    if (!session.info.isManager) {
      res.status(400).json({ error: 'Not a manager session' });
      return;
    }

    const { resumeAt } = req.body ?? {};
    await sessionManager.pauseManager(id, resumeAt);
    res.json({ ok: true });
  });

  // Delete (terminate) session
  router.delete('/:id', async (req: AuthRequest, res) => {
    const id = req.params.id as string;
    const session = sessionManager.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (!isSessionOwner(req, session, sessionManager)) {
      res.status(403).json({ error: 'Not authorized for this session' });
      return;
    }

    await sessionManager.deleteSession(id);
    res.status(204).end();
  });

  return router;
}
