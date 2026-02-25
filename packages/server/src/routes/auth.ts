import { Router } from 'express';
import { readFileSync } from 'fs';
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

// In-memory cache of credentials with bcrypt-hashed passwords.
// The credentials file may be mounted read-only (e.g. Docker :ro), so the
// migration result is kept here and used for all authentication checks.
let cachedCredentials: Credentials | null = null;

function loadCredentials(): Credentials {
  if (cachedCredentials) return cachedCredentials;
  try {
    const raw = readFileSync(config.credentialsPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { users: [] };
  }
}

/** Check if a stored password is a bcrypt hash. */
function isBcryptHash(password: string): boolean {
  return /^\$2[aby]?\$/.test(password);
}

/** Hash all plaintext passwords at startup and cache the result in memory. */
async function migrateAllPasswords(): Promise<void> {
  const credentials = loadCredentials();
  let migrated = 0;

  for (const user of credentials.users) {
    if (!isBcryptHash(user.password)) {
      user.password = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
      migrated++;
      console.log(`[auth] Migrated plaintext password to bcrypt for user "${user.username}"`);
    }
  }

  if (migrated > 0) {
    console.log(`[auth] Bulk migration complete: ${migrated} of ${credentials.users.length} users migrated`);
  }

  cachedCredentials = credentials;
}

/** Pre-hashed test credentials, computed once at startup. */
let testCredentials: { username: string; password: string } | null = null;

/** Hash test credentials once at startup instead of on every login request. */
async function initTestCredentials(): Promise<void> {
  if (process.env.CLAWD_TEST_USER && process.env.CLAWD_TEST_PASSWORD) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[auth] CLAWD_TEST_USER/CLAWD_TEST_PASSWORD are set but ignored in production');
      return;
    }
    console.warn('[auth] Test credentials are active — do not use in production');
    testCredentials = {
      username: process.env.CLAWD_TEST_USER,
      password: await bcrypt.hash(process.env.CLAWD_TEST_PASSWORD, BCRYPT_ROUNDS),
    };
  }
}

/** Verify a password against a stored bcrypt hash. */
async function verifyPassword(inputPassword: string, storedPassword: string): Promise<boolean> {
  if (!isBcryptHash(storedPassword)) {
    console.error('[auth] Non-bcrypt password found — this should not happen after migration');
    return false;
  }
  return bcrypt.compare(inputPassword, storedPassword);
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body as LoginRequest;

    if (!username || !password) {
      const error: ErrorResponse = { error: 'Username and password are required' };
      res.status(400).json(error);
      return;
    }

    const credentials = loadCredentials();

    // Include pre-hashed test credentials if available
    if (testCredentials) {
      credentials.users.push(testCredentials);
    }

    // Use for...of loop since verifyPassword is now async
    let matchedUser: { username: string; password: string } | undefined;
    for (const u of credentials.users) {
      if (u.username === username && await verifyPassword(password, u.password)) {
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) {
      const error: ErrorResponse = { error: 'Invalid credentials' };
      res.status(401).json(error);
      return;
    }

    const token = jwt.sign({ username: matchedUser.username }, config.jwtSecret, {
      expiresIn: '7d',
    });

    const response: LoginResponse = { token };
    res.json(response);
  } catch (err) {
    console.error('[auth] Login error:', err);
    const error: ErrorResponse = { error: 'Internal server error' };
    res.status(500).json(error);
  }
});

export { router as authRouter, migrateAllPasswords, initTestCredentials };
