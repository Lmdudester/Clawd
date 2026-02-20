import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthRequest extends Request {
  user?: { username: string };
}

// Optional external validator for manager API tokens.
// Set by the server at startup to allow manager sessions to authenticate.
let managerTokenValidator: ((token: string) => boolean) | null = null;

export function setManagerTokenValidator(validator: (token: string) => boolean): void {
  managerTokenValidator = validator;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // Check manager API tokens first
  if (managerTokenValidator && managerTokenValidator(token)) {
    req.user = { username: 'manager' };
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { username: string };
    req.user = { username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function verifyToken(token: string): { username: string } | null {
  try {
    return jwt.verify(token, config.jwtSecret) as { username: string };
  } catch {
    return null;
  }
}
