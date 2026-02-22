# Plan: Server Auth & Input Validation Fixes

- **Branch:** `fix/server-auth-validation`
- **Issues addressed:** #59, #82, #66, #84

---

## Issue #59 — JWT secret falls back to hardcoded string in production

### Current State

The issue describes a hardcoded `'clawd-dev-secret'` fallback, but the code has **already been partially fixed**. The current fallback at `packages/server/src/config.ts:17` is:

```typescript
jwtSecret: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
```

This generates a cryptographically random secret when `JWT_SECRET` is not set, so tokens are not forgeable. However, two problems remain:

1. **Token invalidation on restart**: The random fallback regenerates on every server restart, silently logging out all users. This is confusing and undesirable for production deployments.
2. **No guidance in `.env.example`**: Users have no indication that `JWT_SECRET` should be set for persistent sessions.
3. **No startup warning**: The server starts silently without indicating that a random (non-persistent) secret is being used.

### Files to Change

| File | Change |
|------|--------|
| `packages/server/src/config.ts` | Add startup log warning when `JWT_SECRET` is not set |
| `.env.example` | Add `JWT_SECRET` with a comment explaining how to generate one |

### Implementation

1. **`packages/server/src/config.ts`** — After the config object definition, add:
   ```typescript
   if (!process.env.JWT_SECRET) {
     console.warn('[config] WARNING: JWT_SECRET is not set. Using a random secret — all sessions will be invalidated on server restart. Set JWT_SECRET in your .env for persistent authentication.');
   }
   ```

2. **`.env.example`** — Add at the top (since auth is fundamental):
   ```env
   # Required for persistent login sessions across server restarts.
   # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # JWT_SECRET=
   ```

### Risks

- None. The random fallback is already secure; this just adds visibility and guidance.

---

## Issue #82 — No input sanitization on session name (XSS risk in notifications)

### Current State

Session names are accepted without validation in two places:
- **Creation**: `packages/server/src/routes/sessions.ts:28-34` — only checks `!name?.trim()` (non-empty)
- **Settings update**: `packages/server/src/sessions/session-manager.ts:580-581` — assigns `settings.name` directly with no validation

The name is used in ntfy.sh push notification messages at `packages/server/src/ws/handler.ts:49-50,57-58,68`. While ntfy.sh itself does not render HTML in notification titles/bodies (they are plain text), the lack of any length or character restrictions is still a hygiene issue:
- Extremely long names waste bandwidth and could truncate badly in notification UIs
- Control characters (newlines, null bytes) could cause display issues
- Future notification integrations might not be plain-text-safe

### Files to Change

| File | Change |
|------|--------|
| `packages/server/src/routes/sessions.ts` | Add name validation on creation |
| `packages/server/src/sessions/session-manager.ts` | Add same validation in `updateSessionSettings()` |

### Implementation

1. **Add a shared validation helper** in `packages/server/src/routes/sessions.ts` (or inline, since it's simple):
   ```typescript
   function sanitizeSessionName(name: string): string | null {
     // Strip control characters (except space), then trim
     const cleaned = name.replace(/[\x00-\x1F\x7F]/g, '').trim();
     if (!cleaned || cleaned.length > 100) return null;
     return cleaned;
   }
   ```

2. **`packages/server/src/routes/sessions.ts`** — In the POST `/` handler, replace the current `!name?.trim()` check:
   ```typescript
   const sanitizedName = sanitizeSessionName(name);
   if (!sanitizedName || !repoUrl || !branch) {
     res.status(400).json({ error: 'Name (1-100 chars), repoUrl, and branch are required' });
     return;
   }
   ```
   Then pass `sanitizedName` to `createSession()`.

3. **`packages/server/src/sessions/session-manager.ts`** — In `updateSessionSettings()`, validate the name before applying:
   ```typescript
   if (settings.name !== undefined) {
     const cleaned = settings.name.replace(/[\x00-\x1F\x7F]/g, '').trim();
     if (!cleaned || cleaned.length > 100) {
       console.warn(`[session:${sessionId}] Invalid session name update rejected`);
       return;
     }
     session.info.name = cleaned;
   }
   ```

### Risks

- Existing sessions with names > 100 characters would be unable to update their name to the same value. This is acceptable since there shouldn't be any such sessions.
- The 100-character limit is arbitrary but generous; session names are typically short labels.

---

## Issue #66 — Repo URL not validated (command injection via git clone)

### Current State — ALREADY FIXED

This issue has **already been addressed** in the codebase. The session creation route at `packages/server/src/routes/sessions.ts:37-40` validates the repo URL with a strict regex:

```typescript
if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repoUrl)) {
  res.status(400).json({ error: 'repoUrl must be a valid HTTPS GitHub URL (https://github.com/owner/repo)' });
  return;
}
```

Additionally:
- Branch names are validated at line 44: `/^-/.test(branch) || !/^[A-Za-z0-9_.\-/]+$/.test(branch)`
- The shell script at `scripts/session-entrypoint.sh:25` uses `--` before the URL argument to prevent argument injection: `git clone --depth 1 --branch "${GIT_BRANCH:-main}" -- "$GIT_REPO_URL" /workspace`
- The repo URL is only allowed to be HTTPS GitHub URLs, preventing `file://` or other protocol attacks

### Recommendation: SKIP

No code changes needed. Close issue #66 with a comment explaining the existing protections.

---

## Issue #84 — Repos endpoint sends git credentials in URL to GitHub API

### Current State — NOT A REAL VULNERABILITY

The `repos.ts` implementation is **already safe**. The code at `packages/server/src/routes/repos.ts` works as follows:

1. `parseOwnerRepo()` (line 5-10) extracts only `owner` and `repo` from the user-provided URL via regex matching
2. `githubApi()` (line 12-24) constructs API calls as `https://api.github.com${path}` — it **always** sends requests to `api.github.com`, never to the user-provided URL
3. The `GITHUB_TOKEN` is only sent via `Authorization: Bearer ${token}` header to `api.github.com`

A user cannot redirect the token to their own server because the URL is never used as a fetch target — only the extracted owner/repo strings are interpolated into a fixed `api.github.com` path.

**However**, one minor concern: `parseOwnerRepo()` extracts owner/repo with a loose regex (`/github\.com[/:]([^/]+)\/([^/.]+)/`), meaning URLs like `https://evil.github.com.attacker.example/owner/repo` would match. But since the extracted strings are only used as GitHub API path segments (not URLs), the worst case is a 404 from the GitHub API.

### Recommendation: SKIP

The implementation is safe — the GITHUB_TOKEN is never sent to user-controlled URLs. Close issue #84 with a comment explaining the architecture. Optionally, tighten `parseOwnerRepo()` to anchor to `github.com` only (but this is purely cosmetic since `sessions.ts` already validates URLs on session creation).

---

## Summary

| Issue | Action | Effort |
|-------|--------|--------|
| #59 — JWT secret fallback | Add startup warning + `.env.example` entry | Small |
| #82 — Session name sanitization | Add validation in session creation + settings update | Small |
| #66 — Repo URL injection | **SKIP** — already fixed | None |
| #84 — Credentials in URL | **SKIP** — not a real vulnerability | None |

### Implementation Order

1. Issue #59 (JWT warning) — independent, no risk
2. Issue #82 (session name sanitization) — independent, low risk
