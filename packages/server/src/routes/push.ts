import { Router } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import type { PushManager } from '../push/push-manager.js';
import type { VapidStore } from '../push/vapid-store.js';

export function createPushRoutes(pushManager: PushManager, vapidStore: VapidStore): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidStore.getPublicKey() });
  });

  router.post('/subscribe', (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'Invalid push subscription' });
      return;
    }
    pushManager.subscribe({ endpoint, keys });
    res.status(204).end();
  });

  router.delete('/subscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }
    pushManager.unsubscribe(endpoint);
    res.status(204).end();
  });

  return router;
}
