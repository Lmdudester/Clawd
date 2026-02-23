# Fix: Credential Store Path Traversal & Session Token Exposure

**Branch:** `fix/credential-store-path-traversal`
**Issues:** #61, #54

---

## Issue #61: Credential store discover function traverses arbitrary host filesystem paths

### Problem

`CredentialStore.discoverCredentialFiles()` in `packages/server/src/settings/credential-store.ts:71-100` reads directory entries from `{hostDrivePrefix}/Users/` and constructs paths without validating that the resulting paths stay within the expected directory tree. A directory entry containing `..` segments (e.g., a symlink or crafted directory name like `../../etc`) would cause the function to resolve to arbitrary filesystem locations.

The `PUT /api/settings/auth` endpoint (`packages/server/src/routes/settings.ts:23-36`) also accepts an arbitrary `credentialsPath` from the client and passes it directly to `setCredentialsPath()` with no validation — an authenticated user can point the server at any `.credentials.json` file on the filesystem.

`setCredentialsPath()` (line 103) then stores the path and `setupSymlink()` (line 118) creates a symlink to it, potentially linking to sensitive files outside the intended credential directories.

### Attack Surface

1. **`discoverCredentialFiles()`** — directory entries with path traversal sequences escape the `Users/` directory
2. **`setCredentialsPath()` via API** — client-supplied path accepted without validation; creates symlink to arbitrary target
3. **`setupSymlink()`** — creates a symlink from `~/.claude/.credentials.json` to the attacker-controlled path
4. **Volume mount in `createSessionContainer()`** — mounts `claudeDir/.credentials.json` into session containers; a traversed path would mount arbitrary host files

### Fix Approach

#### A. Validate paths in `discoverCredentialFiles()` (credential-store.ts:71-100)

After constructing `claudeDir` from directory entries, validate that the resolved path is still within the expected `usersDir` prefix:

```typescript
const resolved = resolve(claudeDir);
if (!resolved.startsWith(resolve(usersDir) + '/')) {
  console.warn(`[credentials] Skipping suspicious path: ${claudeDir}`);
  continue;
}
```

#### B. Validate `credentialsPath` in `setCredentialsPath()` (credential-store.ts:103-116)

Add path validation before accepting the path. In Docker mode, ensure the resolved path is within `{hostDrivePrefix}/Users/`. In local mode, ensure it is within the user's home directory:

```typescript
setCredentialsPath(claudeDir: string): void {
  this.validateCredentialPath(claudeDir);
  // ... existing logic
}

private validateCredentialPath(claudeDir: string): void {
  const resolved = resolve(claudeDir);

  if (config.hostDrivePrefix) {
    const allowedPrefix = resolve(config.hostDrivePrefix, 'Users') + '/';
    if (!resolved.startsWith(allowedPrefix)) {
      throw new Error(`Credentials path must be within ${allowedPrefix}`);
    }
  } else {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home || !resolved.startsWith(resolve(home) + '/')) {
      throw new Error('Credentials path must be within the home directory');
    }
  }

  // Ensure the path ends with /.claude (expected directory structure)
  if (!resolved.endsWith('/.claude')) {
    throw new Error('Credentials path must point to a .claude directory');
  }
}
```

#### C. Validate path in API route (settings.ts:23-36)

Add a basic format check before calling `setCredentialsPath()`. The real validation is in the store method, but the route should reject obviously malicious input (null bytes, excessive length):

```typescript
if (credentialsPath.includes('\0') || credentialsPath.length > 500) {
  res.status(400).json({ error: 'Invalid credentials path' });
  return;
}
```

### Files to Change

| File | Change |
|------|--------|
| `packages/server/src/settings/credential-store.ts` | Add `validateCredentialPath()` private method. Call it from `setCredentialsPath()`. Add `resolve()` + `startsWith()` check in `discoverCredentialFiles()` loop. |
| `packages/server/src/routes/settings.ts` | Add null-byte and length validation for `credentialsPath` in `PUT /auth` handler. |

---

## Issue #54: Session tokens passed as environment variables are visible in container inspect

### Problem

`SESSION_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN`, `MANAGER_API_TOKEN`, and `internalSecret` (embedded in `MASTER_WS_URL`) are all passed as Docker environment variables in `container-manager.ts:124-158`. Anyone with Docker socket access can run `docker inspect` to read these values in plaintext from any running session container.

### Relevant Env Vars and Sensitivity

| Env Var | Set at | Risk |
|---------|--------|------|
| `SESSION_TOKEN` | container-manager.ts:126 | Allows impersonating the session agent on the internal WebSocket |
| `MASTER_WS_URL` (contains `internalSecret`) | container-manager.ts:127 | The `?secret=` param allows connecting to the internal WS endpoint; combined with any session token, full impersonation |
| `CLAUDE_CODE_OAUTH_TOKEN` | container-manager.ts:137 | Anthropic API access token — full account access |
| `GITHUB_TOKEN` | container-manager.ts:134 | GitHub repository access |
| `MANAGER_API_TOKEN` | container-manager.ts:142 | Allows creating sessions as a manager |

### Fix Approach: Docker Secrets via Tmpfs-mounted Files

Instead of passing secrets as environment variables, write them to temporary files and mount them into the container via a tmpfs-backed volume. The session agent reads secrets from files instead of env vars.

#### Why this approach over alternatives:
- **Docker Swarm secrets** require Swarm mode, which is not a dependency of this project
- **Docker config objects** are also Swarm-only
- **Tmpfs + bind-mounted files** work with standalone Docker and don't persist to disk
- **Passing via the WebSocket after connection** creates a chicken-and-egg problem since `SESSION_TOKEN` and `MASTER_WS_URL` (with `internalSecret`) are needed to establish the WebSocket connection in the first place

#### Implementation

**Step 1: Server-side — write secrets to temp files and mount them (container-manager.ts)**

Create a temporary directory per session, write each secret to a separate file, mount it as a bind into the container at a known path (e.g., `/run/secrets/`), and clean up the temp directory after the container starts (or on removal).

```typescript
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// In createSessionContainer():
const secretsDir = mkdtempSync(join(tmpdir(), `clawd-secrets-${cfg.sessionId}-`));
writeFileSync(join(secretsDir, 'session-token'), cfg.sessionToken, { mode: 0o600 });
writeFileSync(join(secretsDir, 'master-ws-url'), `ws://${config.masterHostname}:${config.port}/internal/session?secret=${config.internalSecret}`, { mode: 0o600 });
if (cfg.oauthToken) writeFileSync(join(secretsDir, 'oauth-token'), cfg.oauthToken, { mode: 0o600 });
if (cfg.githubToken) writeFileSync(join(secretsDir, 'github-token'), cfg.githubToken, { mode: 0o600 });
if (cfg.managerApiToken) writeFileSync(join(secretsDir, 'manager-api-token'), cfg.managerApiToken, { mode: 0o600 });

// Mount the secrets directory read-only
binds.push(`${secretsDir}:/run/secrets:ro`);

// Store secretsDir path for cleanup
this.secretsDirs.set(cfg.sessionId, secretsDir);
```

Remove `SESSION_TOKEN`, `MASTER_WS_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN`, and `MANAGER_API_TOKEN` from the `env` array. Keep non-sensitive vars like `SESSION_ID`, `PERMISSION_MODE`, `GIT_REPO_URL`, `GIT_BRANCH`, `ANTHROPIC_MODEL`, `GIT_USER_NAME`, `GIT_USER_EMAIL`, `DOCKER_HOST`, `MANAGER_MODE`, `MASTER_HTTP_URL` as env vars since they are not secrets.

**Step 2: Clean up secrets on container removal (container-manager.ts)**

In `stopAndRemove()` and the error path of `createSessionContainer()`, delete the temporary secrets directory:

```typescript
private cleanupSecrets(sessionId: string): void {
  const dir = this.secretsDirs.get(sessionId);
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    this.secretsDirs.delete(sessionId);
  }
}
```

**Step 3: Session agent — read secrets from files (session-agent/src/index.ts)**

Add a helper to read secrets from `/run/secrets/` with env var fallback for backwards compatibility:

```typescript
function readSecret(name: string, envFallback?: string): string | undefined {
  const filePath = `/run/secrets/${name}`;
  try {
    return readFileSync(filePath, 'utf-8').trim();
  } catch {
    return envFallback ? process.env[envFallback] : undefined;
  }
}

const SESSION_TOKEN = readSecret('session-token', 'SESSION_TOKEN');
const MASTER_WS_URL = readSecret('master-ws-url', 'MASTER_WS_URL') || 'ws://clawd:4000/internal/session';
```

The env var fallback ensures existing containers still work during a rolling upgrade.

**Step 4: Update container-config.ts**

Update `buildContainerEnv()` and `buildContainerBinds()` to match the changes in `container-manager.ts`. This file appears to be an unused helper (the actual env construction is inline in `container-manager.ts`), but it should be kept in sync.

**Step 5: Update the sensitive env var denylist in session-agent (index.ts:49-56)**

The denylist that strips secrets from setup command environments should be updated to remove entries that are no longer env vars, and add the `/run/secrets/` path to the list of things to protect (though the tmpfs mount is already read-only and not inherited by child processes).

### Files to Change

| File | Change |
|------|--------|
| `packages/server/src/sessions/container-manager.ts` | Add `secretsDirs` map, create temp dir with secret files in `createSessionContainer()`, mount as `/run/secrets:ro`, remove secrets from `env` array, add `cleanupSecrets()` called from `stopAndRemove()` and error cleanup. |
| `packages/server/src/sessions/container-config.ts` | Update `buildContainerEnv()` to remove secret env vars. Update `buildContainerBinds()` to accept and mount secrets dir. |
| `packages/session-agent/src/index.ts` | Add `readSecret()` helper function. Update `SESSION_TOKEN`, `MASTER_WS_URL` reads to use file-based secrets with env fallback. Update `CLAUDE_CODE_OAUTH_TOKEN` references similarly. Update the sensitive env var denylist. |

---

## Risks and Edge Cases

1. **Backwards compatibility**: Existing running containers use env vars. The env var fallback in the session agent ensures they continue working. New containers get file-based secrets.

2. **Temp directory cleanup**: If the master server crashes without calling `stopAndRemove()`, temp secret files remain on disk in `/tmp/`. Mitigation: the `pruneStaleContainers()` method on startup should also clean up orphaned secret directories. Add a cleanup step that removes `clawd-secrets-*` temp dirs whose session IDs are no longer active.

3. **File permissions**: Secret files are created with mode `0o600` and mounted read-only. The container runs as `node` user. Ensure the files are readable by the container's UID. Since the master creates the files as root (or its own UID), and the bind mount is `:ro`, the container process can read them. If running as non-root on the host, ensure the temp files have appropriate permissions (e.g., world-readable or match the container UID). May need to use `0o644` instead of `0o600` since the container UID differs from the host UID.

4. **Docker inspect still shows bind mounts**: The bind mount paths are visible in `docker inspect`, but the actual file contents require filesystem access to the host's `/tmp/` directory, which is a much smaller attack surface than plaintext env vars visible directly in the inspect output.

5. **`MASTER_WS_URL` in container-config.ts**: The `container-config.ts` version doesn't include `?secret=` in the URL (line 12), while `container-manager.ts` does (line 127). The inline version in `container-manager.ts` is the one actually used. Both should be updated consistently.

6. **Token refresh via WebSocket**: `CLAUDE_CODE_OAUTH_TOKEN` is already pushed to containers via the `token_update` WebSocket message (session-manager.ts:171-178, 295-298). Moving it out of env vars has no impact on the refresh flow — the initial token is only needed for the SDK startup, and refreshes arrive over the WebSocket regardless.

---

## Issues NOT Addressed

- **`internalSecret` in `MASTER_WS_URL` as a URL query parameter**: The internal secret is passed as `?secret=` in the WebSocket URL. Even after moving to file-based secrets, the secret is still transmitted as a URL query parameter during the WebSocket upgrade, which means it may appear in server access logs. This is a separate concern (log hygiene) and not addressed here — it could be moved to a WebSocket auth message similar to `SESSION_TOKEN`, but that would require changes to the upgrade handler and is out of scope.

- **Session store persists `sessionToken` in plaintext on disk** (`session-store.json`): The `persistAllImmediate()` method writes session tokens to disk for restart recovery. This is a separate data-at-rest concern.
