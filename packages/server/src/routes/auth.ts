import { Router } from 'express';
import { readFileSync, writeFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
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

const BCRYPT_ROUNDS = 10;

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

function saveCredentials(credentials: Credentials): void {
  try {
    writeFileSync(config.credentialsPath, JSON.stringify(credentials, null, 2));
  } catch (err) {
    console.error('[auth] Failed to save credentials file:', err);
  }
}

/** Check if a stored password is a bcrypt hash. */
function isBcryptHash(password: string): boolean {
  return /^\$2[aby]?\$/.test(password);
}

/** Verify a password against a stored value (bcrypt hash or plaintext for migration). */
function verifyPassword(inputPassword: string, storedPassword: string): boolean {
  if (isBcryptHash(storedPassword)) {
    return bcrypt.compareSync(inputPassword, storedPassword);
  }
  // Plaintext fallback for migration
  return inputPassword === storedPassword;
}

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body as LoginRequest;

  if (!username || !password) {
    const error: ErrorResponse = { error: 'Username and password are required' };
    res.status(400).json(error);
    return;
  }

  const credentials = loadCredentials();

  // Allow env-based test credentials (for automated E2E testing, non-production only)
  if (process.env.CLAWD_TEST_USER && process.env.CLAWD_TEST_PASSWORD) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[auth] CLAWD_TEST_USER/CLAWD_TEST_PASSWORD are set but ignored in production');
    } else {
      console.warn('[auth] Test credentials are active — do not use in production');
      credentials.users.push({
        username: process.env.CLAWD_TEST_USER,
        password: process.env.CLAWD_TEST_PASSWORD,
      });
    }
  }

  const user = credentials.users.find(
    (u) => u.username === username && verifyPassword(password, u.password)
  );

  if (!user) {
    const error: ErrorResponse = { error: 'Invalid credentials' };
    res.status(401).json(error);
    return;
  }

  // Auto-migrate plaintext passwords to bcrypt hashes on successful login
  if (!isBcryptHash(user.password)) {
    console.log(`[auth] Migrating plaintext password to bcrypt for user "${username}"`);
    const persistedCredentials = loadCredentials();
    const persistedUser = persistedCredentials.users.find((u) => u.username === username);
    if (persistedUser) {
      persistedUser.password = bcrypt.hashSync(password, BCRYPT_ROUNDS);
      saveCredentials(persistedCredentials);
    }
  }

  const token = jwt.sign({ username: user.username }, config.jwtSecret, {
    expiresIn: '7d',
  });

  const response: LoginResponse = { token };
  res.json(response);
});

export { router as authRouter };
