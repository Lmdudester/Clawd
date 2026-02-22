# Plan: Fix Session Permission Bypass Bugs

**Branch:** `fix/session-permission-bypass`
**Issues:** #156, #157, #135

---

## Issue #156: Path traversal in auto_edits mode bypasses CWD restriction

### Problem

In `auto_edits` permission mode, the `canUseTool` callback in `sdk-runner.ts` (lines 419-426) checks whether a file path starts with the session's CWD using `String.startsWith()` on unresolved paths. Paths containing `../` segments (e.g., `/home/user/project/../../etc/passwd`) pass the prefix check but resolve to locations outside the project directory.

### File to change

`packages/session-agent/src/sdk-runner.ts` — lines 419-426 (inside `canUseTool` callback)

### Implementation

Replace the raw `startsWith` check with `path.resolve()` normalization:

```typescript
// Current (vulnerable):
const normalizedFile = filePath?.replace(/\\/g, '/');
const normalizedCwd = this.cwd.replace(/\\/g, '/');
if (normalizedFile && normalizedFile.startsWith(normalizedCwd + '/')) {

// Fixed:
import path from 'path';
// ...
const resolvedFile = filePath ? path.resolve(filePath) : null;
const resolvedCwd = path.resolve(this.cwd);
if (resolvedFile && resolvedFile.startsWith(resolvedCwd + '/')) {
```

`path.resolve()` canonicalizes all `.` and `..` segments, so `/home/user/project/../../etc/passwd` becomes `/etc/passwd`, which correctly fails the `startsWith('/home/user/project/')` check.

### Details

- Add `import path from 'path';` at the top of the file (Node.js built-in, no new dependency).
- The `path` module is already available — this is a Node.js environment inside a Docker container.
- The backslash normalization (`replace(/\\/g, '/')`) becomes unnecessary since `path.resolve()` handles platform-native separators. However, since this runs on Linux containers where `path.sep` is `/`, `path.resolve` alone is sufficient.

### Risks

- **None.** `path.resolve()` is the standard way to canonicalize paths in Node.js. It has no side effects (doesn't touch the filesystem). The change is strictly more restrictive — paths that were previously (incorrectly) allowed will now be correctly blocked.

---

## Issue #157: isReadOnlyBash bypassed via curl -XPOST and gh api --method=POST

### Problem

Two regex patterns in `isReadOnlyBash` fail to catch alternative argument syntax:

1. **`DANGEROUS_CURL_FLAGS` (line 48):** The pattern `-X\s+(?!GET\b)\S` requires whitespace between `-X` and the method. `curl` accepts `-XPOST` (no space), which bypasses the check.

2. **`gh api` check (line 67):** The pattern `--method\s+(?!GET\b)` requires whitespace after `--method`. `gh api` accepts `--method=POST` (equals sign), which bypasses the check. Additionally, `gh api` also accepts `-X` as a short alias for `--method`, which is not checked at all.

### File to change

`packages/session-agent/src/sdk-runner.ts` — lines 48 and 67

### Implementation

**Fix 1 — DANGEROUS_CURL_FLAGS regex (line 48):**

Change `-X\s+(?!GET\b)\S` to `-X\s*(?!GET\b)[A-Z]` within the existing regex:

```typescript
// Current:
const DANGEROUS_CURL_FLAGS = /(?:^|\s)(?:-X\s+(?!GET\b)\S|-d\b|--data\b|...)/i;

// Fixed (only the -X part changes):
const DANGEROUS_CURL_FLAGS = /(?:^|\s)(?:-X\s*(?!GET\b)[A-Z]|-d\b|--data\b|...)/i;
```

- `\s*` instead of `\s+` matches both `-X POST` and `-XPOST`.
- `[A-Z]` instead of `\S` ensures we're matching a method name character (with the `/i` flag this is case-insensitive). This avoids false positives on `-X` appearing alone without a method.

**Fix 2 — gh api --method check (line 67):**

Change the regex to handle `=` syntax and add `-X` short flag:

```typescript
// Current:
if (/^gh\s+api\s/.test(sub) && /--method\s+(?!GET\b)/i.test(sub)) return false;

// Fixed:
if (/^gh\s+api\s/.test(sub) && /(?:--method[=\s]\s*|-X\s*)(?!GET\b)[A-Z]/i.test(sub)) return false;
```

- `--method[=\s]\s*` matches `--method POST`, `--method=POST`, and `--method= POST`.
- `-X\s*` matches `-X POST` and `-XPOST` (gh api also accepts `-X` as shorthand for `--method`).
- `(?!GET\b)[A-Z]` ensures there's a non-GET method name following.

### Details

- Both changes are pure regex modifications to existing patterns — no structural changes.
- The `curl` fix only changes `\s+` to `\s*` and `\S` to `[A-Z]` within the existing alternation group.
- The `gh api` fix extends the existing regex to handle two additional syntax forms.

### Risks

- **False negatives (bypasses we miss):** Curl also accepts `--request` as a long form of `-X`. The current code doesn't check `--request` either, but this is a pre-existing gap not covered by this issue. We should add it: include `--request[=\s]\s*(?!GET\b)[A-Z]` in the `DANGEROUS_CURL_FLAGS` regex. This is low-risk and directly related.
- **False positives:** Minimal. The `[A-Z]` match ensures we only trigger on method-like tokens, not on flags that happen to start with `-X` for other reasons (there are no common curl/gh flags like that).

---

## Issue #135: Manager sessions can kill arbitrary sessions (missing ownership check)

### Problem

The `isSessionOwner()` function in `packages/server/src/routes/sessions.ts` (lines 7-11) returns `true` for *any* request with a manager API token, regardless of which session is being targeted. This allows Manager A to terminate, message, or modify sessions belonging to Manager B or other users.

The infrastructure to do a proper check already exists:
- `session-manager.ts` line 96: manager sessions have `managerState.childSessionIds`
- `session-manager.ts` line 203: child sessions have `info.managedBy` set to the parent manager ID
- `session-manager.ts` line 183: `findManagerByToken(token)` resolves a token to a manager session ID

### Files to change

1. **`packages/server/src/routes/sessions.ts`** — `isSessionOwner()` function (lines 7-11) and all call sites
2. **`packages/server/src/auth/middleware.ts`** — add `managerSessionId` to `AuthRequest` (optional optimization)

### Implementation

**Approach A (minimal, preferred): Pass session object to isSessionOwner**

The function already receives the `req` (which has `managerApiToken`) and the target session is already looked up at each call site. We can pass the session's `managedBy` field:

```typescript
function isSessionOwner(req: AuthRequest, session: { info: { createdBy: string; managedBy?: string } }, sessionManager: SessionManager): boolean {
  if (req.managerApiToken) {
    // Resolve which manager session this token belongs to
    const managerId = sessionManager.findManagerByToken(req.managerApiToken);
    if (!managerId) return false;
    // Check: is the target session managed by this manager?
    return session.info.managedBy === managerId;
  }
  return req.user?.username === session.info.createdBy;
}
```

**Call site changes:** Every call to `isSessionOwner` already has the `session` object in scope. Update the signature at all 7 call sites (lines 76, 98, 113, 136, 160, 189, 211) to pass `session` and `sessionManager`:

```typescript
// Before:
if (!isSessionOwner(req, session.info.createdBy)) {

// After:
if (!isSessionOwner(req, session, sessionManager)) {
```

The `sessionManager` is already available in the closure created by `createSessionRoutes(sessionManager)`.

**Approach B (alternative): Resolve manager session ID in middleware**

Resolve `managerSessionId` in the auth middleware and attach it to `req`. This avoids calling `findManagerByToken` in every route handler, but couples the middleware to the session manager.

**Recommendation:** Approach A. It keeps the auth middleware decoupled from session state, and `findManagerByToken` is a simple Map iteration — negligible cost.

### Details

- The `managedBy` field is set on child sessions in `trackChildSession()` (session-manager.ts line 202).
- For sessions created by a manager via `POST /`, the child is linked in the route handler (sessions.ts lines 54-58) which calls `trackChildSession`.
- A manager should also be able to access sessions it creates (which automatically get `managedBy` set). The `managedBy === managerId` check handles this correctly.
- The manager's *own* session is created by a regular user (via the UI), so `managedBy` is not set. Manager tokens should NOT be used to access the manager session itself — the regular user JWT handles that. If a manager token tries to access a session with no `managedBy`, the check returns `false`, which is correct.

### Risks

- **Manager losing access to its own children:** Only if `trackChildSession` fails to set `managedBy`. But this path is well-established and tested — the UI already uses `managedBy` to show the "Managed" badge.
- **Breaking existing manager workflows:** Managers creating sessions via `POST /` with their API token already have `trackChildSession` called in the route handler. The child gets `managedBy = managerId`. The ownership check will pass.
- **Edge case — manually created sessions:** If someone creates a session via the API without a manager token and then tries to manage it with a manager token, it will be denied. This is the intended behavior.

---

## Summary of changes

| Issue | File | Change | Lines of code |
|-------|------|--------|---------------|
| #156 | `packages/session-agent/src/sdk-runner.ts` | Add `path` import; use `path.resolve()` in auto_edits check | ~5 |
| #157 | `packages/session-agent/src/sdk-runner.ts` | Fix curl `-X` regex; fix gh api `--method` regex; add `--request` to curl | ~3 |
| #135 | `packages/server/src/routes/sessions.ts` | Update `isSessionOwner` to verify manager-child relationship | ~15 |

**Total estimated diff:** ~23 lines changed across 2 files. All fixes are minimal, targeted, and introduce no new dependencies.

## Testing considerations

- **#156:** Unit test `isReadOnlyBash` and the auto_edits path check with traversal payloads like `/cwd/../../etc/passwd`.
- **#157:** Unit test `isReadOnlyBash` with `curl -XPOST`, `curl -XDELETE`, `gh api --method=POST`, `gh api --method=DELETE`, `gh api -XPOST`.
- **#135:** Integration test that Manager A's token is rejected when targeting Manager B's child session, and accepted when targeting its own child.

Existing tests in `sessions.integration.test.ts` may need updates if they rely on the permissive manager behavior.
