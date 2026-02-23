import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret-for-auth-integration';

vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret-for-auth-integration',
    credentialsPath: '/nonexistent/credentials.json',
  },
}));

// Pre-computed bcrypt hash of 'secret123' (10 rounds) — migration is a no-op with this
const HASHED_SECRET123 = '$2b$10$VwQWypA1XeL1mtZXY4nkMO0ZV3ww/EVu/V019XXtjBEiIccPGx.Ke';

// Mock fs to provide test credentials with pre-hashed passwords
vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('fs')>();
  return {
    ...orig,
    readFileSync: vi.fn((path: string) => {
      if (path === '/nonexistent/credentials.json') {
        return JSON.stringify({
          users: [
            { username: 'admin', password: HASHED_SECRET123 },
          ],
        });
      }
      return orig.readFileSync(path, 'utf-8');
    }),
    writeFileSync: vi.fn(),
  };
});

import { authRouter } from './auth.js';
import { verifyToken } from '../auth/middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

async function request(app: express.Express, method: string, path: string, body?: any) {
  const { createServer } = await import('http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, async () => {
      const addr = server.address() as any;
      try {
        const headers: Record<string, string> = {};
        if (body) headers['Content-Type'] = 'application/json';

        const res = await fetch(`http://localhost:${addr.port}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        const responseBody = await res.json();
        resolve({ status: res.status, body: responseBody });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe('auth routes', () => {
  it('returns token for valid credentials', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/auth/login', {
      username: 'admin',
      password: 'secret123',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
  });

  it('returned token is verifiable', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/auth/login', {
      username: 'admin',
      password: 'secret123',
    });

    const user = verifyToken(res.body.token);
    expect(user).toMatchObject({ username: 'admin' });
  });

  it('returns 401 for wrong password', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/auth/login', {
      username: 'admin',
      password: 'wrongpass',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 for missing username', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/auth/login', {
      password: 'secret123',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing password', async () => {
    const app = createApp();
    const res = await request(app, 'POST', '/api/auth/login', {
      username: 'admin',
    });

    expect(res.status).toBe(400);
  });
});
