import { Router } from 'express';
import { authMiddleware } from '../auth/middleware.js';
import type { CredentialStore } from '../settings/credential-store.js';
import type { UsageResponse, RateLimitBucket, UnifiedBucket } from '@clawd/shared';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

function parseBucket(headers: Headers, prefix: string): RateLimitBucket | null {
  const limit = headers.get(`anthropic-ratelimit-${prefix}-limit`);
  const remaining = headers.get(`anthropic-ratelimit-${prefix}-remaining`);
  const reset = headers.get(`anthropic-ratelimit-${prefix}-reset`);

  if (limit == null || remaining == null || reset == null) return null;

  return {
    limit: Number(limit),
    remaining: Number(remaining),
    reset,
  };
}

function parseUnifiedBucket(headers: Headers, window: string): UnifiedBucket | null {
  const utilization = headers.get(`anthropic-ratelimit-unified-${window}-utilization`);
  const reset = headers.get(`anthropic-ratelimit-unified-${window}-reset`);
  const status = headers.get(`anthropic-ratelimit-unified-${window}-status`);

  if (utilization == null || reset == null || status == null) return null;

  return {
    utilization: Number(utilization),
    reset: Number(reset),
    status,
  };
}

export function createUsageRoutes(credentialStore: CredentialStore): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', async (req, res) => {
    const status = credentialStore.getStatus();

    if (status.method === 'none') {
      const response: UsageResponse = {
        requests: null,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
        unified5h: null,
        unified7d: null,
        unifiedFallbackPct: null,
        authMethod: 'none',
        fetchedAt: new Date().toISOString(),
      };
      res.json(response);
      return;
    }

    // Build headers for the Anthropic API call
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (status.method === 'oauth_credentials_file') {
      const token = credentialStore.getAccessToken();
      if (!token) {
        res.status(500).json({ error: 'Could not read OAuth access token' });
        return;
      }
      headers['Authorization'] = `Bearer ${token}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
    } else {
      // env_fallback — use ANTHROPIC_API_KEY
      headers['x-api-key'] = process.env.ANTHROPIC_API_KEY!;
    }

    try {
      const apiRes = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      const h = apiRes.headers;

      // Parse standard API tier headers
      const requests = parseBucket(h, 'requests');
      const tokens = parseBucket(h, 'tokens');
      const inputTokens = parseBucket(h, 'input-tokens');
      const outputTokens = parseBucket(h, 'output-tokens');

      // Parse Claude Max unified headers
      const unified5h = parseUnifiedBucket(h, '5h');
      const unified7d = parseUnifiedBucket(h, '7d');
      const fallbackPct = h.get('anthropic-ratelimit-unified-fallback-percentage');

      const response: UsageResponse = {
        requests,
        tokens,
        inputTokens,
        outputTokens,
        unified5h,
        unified7d,
        unifiedFallbackPct: fallbackPct != null ? Number(fallbackPct) : null,
        authMethod: status.method,
        fetchedAt: new Date().toISOString(),
      };

      res.json(response);
    } catch (err: any) {
      console.error('Usage fetch error:', err);
      res.status(502).json({ error: `Failed to fetch usage from Anthropic: ${err.message}` });
    }
  });

  return router;
}
