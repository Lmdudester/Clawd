import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthRequest extends Request {
  user?: { username: string };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
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
