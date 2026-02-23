# Plan: Auth Hardening

- **Branch:** `fix/auth-hardening`
- **Issues:** #46 (plaintext password comparison), #47 (no rate limiting on login)

## Current State Analysis

After reading `packages/server/src/routes/auth.ts`, both issues have **already been partially addressed** in the existing code:

### Rate Limiting (#47) — Already Implemented

The login route already has `express-rate-limit` applied:

```ts
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, (req, res) => { ... });
```

- `express-rate-limit@^8.2.1` is in `packages/server/package.json`
- Configuration: 5 attempts per 60-second window, with standard headers
- **No code changes needed.** This issue can be closed as-is.

### Password Hashing (#46) — Partially Implemented (Plaintext Fallback Remains)

The code already uses bcrypt for hashing and has an auto-migration path:

- `bcrypt@^6.0.0` is in `packages/server/package.json`
- `isBcryptHash()` detects whether a stored password is a bcrypt hash
- `verifyPassword()` compares against bcrypt hashes, but **falls back to plaintext comparison** for un-migrated passwords (line 53)
- On successful login with a plaintext password, the code auto-migrates it to a bcrypt hash (lines 90-98)

The **remaining vulnerability** is the plaintext fallback in `verifyPassword()`:

```ts
// Plaintext fallback for migration
return inputPassword === storedPassword;
```

This is intentional for migration — without it, users with plaintext passwords in `credentials.json` would be locked out. However, it means plaintext passwords are accepted indefinitely until each user logs in at least once.

## Files to Change

### 1. `packages/server/src/routes/auth.ts`

**Change:** Add a one-time bulk migration function that hashes all plaintext passwords at server startup, then remove the plaintext fallback from `verifyPassword()`.

Specific modifications:

- **Add `migrateAllPasswords()` function** — reads the credentials file, finds any user whose password is not a bcrypt hash, hashes it with `bcrypt.hashSync(password, BCRYPT_ROUNDS)`, and saves the file. Logs each migrated user. This runs once at module load time.

- **Remove the plaintext fallback** from `verifyPassword()` — after bulk migration, all passwords will be bcrypt hashes. The function should only use `bcrypt.compareSync()` and never do `inputPassword === storedPassword`.

- **Remove the per-login migration block** (lines 90-98) — no longer needed after bulk migration.

```ts
// BEFORE
function verifyPassword(inputPassword: string, storedPassword: string): boolean {
  if (isBcryptHash(storedPassword)) {
    return bcrypt.compareSync(inputPassword, storedPassword);
  }
  return inputPassword === storedPassword;
}

// AFTER
function verifyPassword(inputPassword: string, storedPassword: string): boolean {
  if (!isBcryptHash(storedPassword)) {
    console.error('[auth] Non-bcrypt password found — this should not happen after migration');
    return false;
  }
  return bcrypt.compareSync(inputPassword, storedPassword);
}
```

- **Keep `isBcryptHash()` and `saveCredentials()`** — they're still useful for the migration function and potentially future use.

### 2. `packages/server/src/routes/auth.integration.test.ts`

**Change:** Update test fixtures to use bcrypt-hashed passwords instead of plaintext, since the route will no longer accept plaintext passwords.

The mock `readFileSync` currently returns `{ username: 'admin', password: 'secret123' }` as plaintext. This needs to be changed to a pre-computed bcrypt hash of `'secret123'`.

### 3. No other files need changes

The `credential-store.ts` file is unrelated — it manages Claude API OAuth tokens, not user login credentials.

## Implementation Approach

### Password Hashing Migration Strategy

1. At module load time in `auth.ts`, call `migrateAllPasswords()` which:
   - Loads the credentials file
   - Iterates all users, hashing any plaintext passwords with `bcrypt.hashSync()`
   - Writes the updated file back if any migrations occurred
   - Logs a summary (e.g., "Migrated 2 of 5 users to bcrypt")
2. After migration, `verifyPassword()` rejects any non-bcrypt passwords as an error (defense-in-depth)
3. The per-login migration code is removed since it's now redundant

This approach is safe because:
- The migration is idempotent — running it on already-hashed passwords is a no-op
- `bcrypt.hashSync` is deterministic per salt, and we generate a new salt each time (which is fine — we only need to verify, not reproduce)
- The credentials file write uses `JSON.stringify` with consistent formatting

### Rate Limiting

No changes needed. The existing configuration is reasonable for a self-hosted tool:
- 5 requests per 60-second window per IP
- Standard `RateLimit-*` headers returned to clients
- Clear error message on limit exceeded

## Risks and Edge Cases

1. **Credentials file permissions:** If the server process doesn't have write access to `credentials.json`, the bulk migration will fail. The existing `saveCredentials()` already has a try/catch that logs errors, so this will be visible but non-fatal. However, `verifyPassword()` will then reject plaintext passwords, locking users out. **Mitigation:** Log a clear error message during migration if the write fails, advising the admin to either fix permissions or manually hash passwords.

2. **Test credential env vars:** The `CLAWD_TEST_USER`/`CLAWD_TEST_PASSWORD` path pushes plaintext credentials into the array at request time. These won't be in the credentials file and won't be migrated. **Mitigation:** For test credentials injected via env vars, hash them at comparison time using `bcrypt.hashSync()` before pushing into the array, or hash them once at startup and cache the result.

3. **Concurrent access:** If multiple server instances share the same credentials file, the bulk migration could race. This is unlikely in a single-Docker deployment but worth noting. The existing TOCTOU-aware pattern (re-read before write) from the per-login migration should be preserved in the bulk migration.

4. **bcrypt.hashSync is blocking:** The bulk migration uses synchronous bcrypt hashing, which blocks the event loop. For a small number of users (typical for self-hosted), this is negligible. For large user lists, `bcrypt.hash()` (async) would be preferable, but this adds complexity and is unlikely to be needed.

## Issues Summary

| Issue | Status | Action |
|-------|--------|--------|
| #46 Plaintext password comparison | Fix needed | Remove plaintext fallback, add bulk migration |
| #47 No rate limiting on login | Already fixed | Close — `express-rate-limit` already applied |
