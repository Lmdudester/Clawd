import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../config.js', () => ({
  config: { jwtSecret: 'test-jwt-secret-for-unit-tests' },
}));

import { verifyToken, authMiddleware, type AuthRequest } from './middleware.js';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

describe('verifyToken', () => {
  it('returns user for valid token', () => {
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });
    const result = verifyToken(token);
    expect(result).toMatchObject({ username: 'alice' });
  });

  it('returns null for expired token', () => {
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '-1s' });
    expect(verifyToken(token)).toBeNull();
  });

  it('returns null for token signed with wrong secret', () => {
    const token = jwt.sign({ username: 'alice' }, 'wrong-secret');
    expect(verifyToken(token)).toBeNull();
  });

  it('returns null for completely invalid token', () => {
    expect(verifyToken('not-a-jwt')).toBeNull();
  });
});

describe('authMiddleware', () => {
  function createMockReqRes(authHeader?: string) {
    const req = {
      headers: { authorization: authHeader },
    } as unknown as AuthRequest;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();
    return { req, res, next };
  }

  it('calls next and sets req.user for valid token', () => {
    const token = jwt.sign({ username: 'alice' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next } = createMockReqRes(`Bearer ${token}`);

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ username: 'alice' });
  });

  it('returns 401 for missing authorization header', () => {
    const { req, res, next } = createMockReqRes(undefined);

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for non-Bearer authorization', () => {
    const { req, res, next } = createMockReqRes('Basic dXNlcjpwYXNz');

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', () => {
    const { req, res, next } = createMockReqRes('Bearer invalid-token');

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
