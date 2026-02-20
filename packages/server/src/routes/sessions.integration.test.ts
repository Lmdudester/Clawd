import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { createSessionRoutes } from './sessions.js';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret-for-integration';

vi.mock('../config.js', () => ({
  config: { jwtSecret: 'test-jwt-secret-for-integration' },
}));

function createTestToken() {
  return jwt.sign({ username: 'testuser' }, TEST_SECRET, { expiresIn: '1h' });
}

function createMockSessionManager() {
  return {
    getSessions: vi.fn(() => [
      { id: 's1', name: 'Session 1', status: 'idle' },
    ]),
    getSession: vi.fn((id: string) => {
      if (id === 's1') {
        return {
          info: { id: 's1', name: 'Session 1', status: 'idle' },
          pendingApproval: null,
          pendingQuestion: null,
        };
      }
      return undefined;
    }),
    getMessages: vi.fn(() => []),
    createSession: vi.fn(async (name: string, repoUrl: string, branch: string) => ({
      id: 'new-session',
      name,
      repoUrl,
      branch,
      status: 'starting',
    })),
    deleteSession: vi.fn(async () => {}),
  } as any;
}

function createApp(sessionManager: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(sessionManager));
  return app;
}

async function request(app: express.Express, method: string, path: string, body?: any, token?: string) {
  const { createServer } = await import('http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, async () => {
      const addr = server.address() as any;
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';

        const res = await fetch(`http://localhost:${addr.port}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        const responseBody = res.status === 204 ? null : await res.json();
        resolve({ status: res.status, body: responseBody });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe('session routes', () => {
  it('GET /api/sessions returns session list', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'GET', '/api/sessions', undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].id).toBe('s1');
  });

  it('GET /api/sessions returns 401 without auth', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);

    const res = await request(app, 'GET', '/api/sessions');
    expect(res.status).toBe(401);
  });

  it('POST /api/sessions creates session with valid body', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'POST', '/api/sessions', {
      name: 'New Session',
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
    }, token);

    expect(res.status).toBe(201);
    expect(res.body.session.name).toBe('New Session');
    expect(sm.createSession).toHaveBeenCalledWith('New Session', 'https://github.com/test/repo', 'main', false);
  });

  it('POST /api/sessions returns 400 without name', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'POST', '/api/sessions', {
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
    }, token);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('POST /api/sessions returns 400 without repoUrl', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'POST', '/api/sessions', {
      name: 'Test',
      branch: 'main',
    }, token);

    expect(res.status).toBe(400);
  });

  it('GET /api/sessions/:id returns session details', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'GET', '/api/sessions/s1', undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe('s1');
  });

  it('GET /api/sessions/:id returns 404 for nonexistent', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'GET', '/api/sessions/nonexistent', undefined, token);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/sessions/:id returns 204', async () => {
    const sm = createMockSessionManager();
    const app = createApp(sm);
    const token = createTestToken();

    const res = await request(app, 'DELETE', '/api/sessions/s1', undefined, token);
    expect(res.status).toBe(204);
    expect(sm.deleteSession).toHaveBeenCalledWith('s1');
  });
});
