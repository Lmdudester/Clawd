# Plan: Auth Security Hardening

**Branch:** `fix/auth-security-hardening`
**Issues:** #164, #165, #166

---

## Issue #164: Test credentials re-hashed on every login request

### Problem
In `packages/server/src/routes/auth.ts:90-99`, when `CLAWD_TEST_USER`/`CLAWD_TEST_PASSWORD` env vars are set, `bcrypt.hashSync()` is called on every login request to hash the test password before pushing it onto the credentials list. This is wasteful (~50-100ms of blocking CPU per login) and grows the in-memory array on every request.

### Fix
Pre-hash the test credentials once at module load time and store them in a module-level variable. In the login handler, push the pre-computed entry instead of re-hashing.

### Files to change
- **`packages/server/src/routes/auth.ts`**
  - After the `migrateAllPasswords()` call (line 67), add a block that checks for `CLAWD_TEST_USER`/`CLAWD_TEST_PASSWORD`, hashes the password once (using async `bcrypt.hash`), and stores the result in a module-level `let testCredentials: { username: string; password: string } | null = null`.
  - Since module-level code runs synchronously but we want async bcrypt, use an immediately-invoked async function or compute it synchronously at startup (acceptable since it's one-time). Alternatively, use a lazy initialization pattern: hash once on first access, cache thereafter. **Decision: use `bcrypt.hash` in an exported `initTestCredentials()` async function called from `index.ts` at startup.**
  - In the login handler (lines 90-99), replace the `bcrypt.hashSync` call with a push of the cached `testCredentials` if non-null.

---

## Issue #165: Synchronous bcrypt calls block the event loop

### Problem
- `bcrypt.hashSync()` in `migrateAllPasswords()` (line 54) — runs at startup, blocking is acceptable here but should still be async for consistency.
- `bcrypt.hashSync()` in the login handler test credentials block (line 97) — blocks on every login request. Fixed by #164 above.
- `bcrypt.compareSync()` in `verifyPassword()` (line 75) — blocks for ~50-100ms on every login attempt.

### Fix
Convert all bcrypt operations to their async equivalents (`bcrypt.hash`, `bcrypt.compare`). This requires making the calling functions async.

### Files to change
- **`packages/server/src/routes/auth.ts`**
  - `migrateAllPasswords()` → rename to `async migrateAllPasswords()`. Replace `bcrypt.hashSync(...)` with `await bcrypt.hash(...)`. Change the call site: instead of calling at module top-level (line 67), export it and call from `index.ts` at startup.
  - `verifyPassword()` → rename to `async verifyPassword()`, return `Promise<boolean>`. Replace `bcrypt.compareSync(...)` with `await bcrypt.compare(...)`.
  - Login handler (line 78) → make the callback `async`. Await `verifyPassword`. Since `Array.find()` doesn't support async predicates, refactor the user lookup to use a `for...of` loop that awaits each comparison.
  - `initTestCredentials()` (new) → async function that hashes test password with `await bcrypt.hash()`. Called once at startup from `index.ts`.

- **`packages/server/src/index.ts`**
  - Import and call `migrateAllPasswords()` and `initTestCredentials()` during the startup sequence (before `server.listen`). Both are async, so await them inside the existing `.then(async () => { ... })` block or at top-level.

---

## Issue #166: Internal secret in query parameter + world-readable file permissions

### Problem
Two sub-issues:
1. **World-readable secrets files:** `writeFileSync(..., { mode: 0o644 })` on lines 148, 153-156 of `container-manager.ts`. The secrets directory is bind-mounted read-only into containers, but on the host filesystem, any user can read these files.
2. **Secret in URL query parameter:** The internal secret is embedded in the WebSocket URL written to `master-ws-url` (line 151). Query parameters can appear in logs, process listings (`/proc/*/cmdline`), and HTTP access logs. This is a security anti-pattern.

### Fix — File permissions
Change `mode: 0o644` to `mode: 0o600` on all `writeFileSync` calls for secret files. This restricts read access to the file owner only.

### Fix — Secret in query parameter
Separate the internal secret from the WebSocket URL. Write it as its own file (`internal-secret`) and pass it via a WebSocket header (`X-Internal-Secret`) during the upgrade handshake instead of as a query parameter.

### Files to change

- **`packages/server/src/sessions/container-manager.ts`**
  - Line 148: Change `{ mode: 0o644 }` to `{ mode: 0o600 }` for `session-token`.
  - Lines 149-153: Remove `?secret=${config.internalSecret}` from the `master-ws-url` value. Write just `ws://${config.masterHostname}:${config.port}/internal/session`.
  - After the `master-ws-url` write, add a new `writeFileSync` for `join(secretsDir, 'internal-secret')` containing `config.internalSecret`, with `{ mode: 0o600 }`.
  - Lines 154-156: Change `{ mode: 0o644 }` to `{ mode: 0o600 }` for `oauth-token`, `github-token`, and `manager-api-token`.

- **`packages/session-agent/src/index.ts`**
  - After line 23 (`MASTER_WS_URL`), add: `const INTERNAL_SECRET = readSecret('internal-secret');`
  - Line 42: Pass the internal secret to `MasterClient` constructor: `new MasterClient(MASTER_WS_URL, SESSION_ID!, SESSION_TOKEN!, INTERNAL_SECRET)`.

- **`packages/session-agent/src/master-client.ts`**
  - Update the constructor (line 19-23) to accept an optional `internalSecret?: string` parameter.
  - Line 38: When creating the WebSocket, pass headers if secret is available:
    ```typescript
    this.ws = new WebSocket(this.masterUrl, {
      headers: this.internalSecret ? { 'x-internal-secret': this.internalSecret } : undefined,
    });
    ```

- **`packages/server/src/index.ts`**
  - Lines 112-121: Change the internal WebSocket secret validation from reading `url.searchParams.get('secret')` to reading `req.headers['x-internal-secret']`. Support both methods during transition (check header first, fall back to query param) for robustness, then log a deprecation warning if the query param method is used.

---

## Implementation Order

1. **#166 — File permissions** (smallest, isolated change in `container-manager.ts`)
2. **#166 — Secret in header** (changes span server + session-agent, but are straightforward)
3. **#164 + #165 — Async bcrypt + test credential caching** (these are intertwined; do together)

## Risks and Considerations

- **Async migration of `migrateAllPasswords`**: Currently called synchronously at module load. Moving it to an explicit async init function called from `index.ts` is safe since the server doesn't listen until after the `containerManager.initialize().then(...)` block resolves. We just need to ensure migration runs before the server starts accepting requests.
- **Async login handler**: Express supports async route handlers, but unhandled rejections need a try/catch wrapper or an async error middleware. We'll wrap the handler body in try/catch.
- **Header-based auth backward compatibility**: If any existing running containers still have the query-param URL, they won't include the header. The dual-check approach (header first, then query param) ensures they can still reconnect. The query-param fallback can be removed in a future release.
- **File permission change**: Only affects newly created secret files. Existing running containers already have their secrets mounted. No impact on running sessions.
- **`for...of` loop for user lookup**: Slightly changes the semantics — previously `Array.find` would short-circuit on the first username + password match. The `for...of` loop will do the same (break on first match), so behavior is preserved. However, we should be careful to compare username first (cheap) before calling async `verifyPassword` (expensive) to avoid unnecessary bcrypt comparisons.

## Issues to skip

None — all three issues are feasible and will be addressed.
