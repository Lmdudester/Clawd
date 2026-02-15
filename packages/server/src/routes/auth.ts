import { Router } from 'express';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import type { LoginRequest, LoginResponse, ErrorResponse } from '@clawd/shared';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

interface Credentials {
  users: Array<{ username: string; password: string }>;
}

function loadCredentials(): Credentials {
  try {
    const raw = readFileSync(config.credentialsPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { users: [] };
  }
}

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body as LoginRequest;

  if (!username || !password) {
    const error: ErrorResponse = { error: 'Username and password are required' };
    res.status(400).json(error);
    return;
  }

  const credentials = loadCredentials();
  const user = credentials.users.find(
    (u) => u.username === username && u.password === password
  );

  if (!user) {
    const error: ErrorResponse = { error: 'Invalid credentials' };
    res.status(401).json(error);
    return;
  }

  const token = jwt.sign({ username: user.username }, config.jwtSecret, {
    expiresIn: '7d',
  });

  const response: LoginResponse = { token };
  res.json(response);
});

export { router as authRouter };
