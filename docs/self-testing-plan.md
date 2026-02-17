# Plan: Enable Clawd Sessions to Test Clawd Instances via Playwright

## Context

A Clawd session (running Claude Code inside a Docker container) should be able to spin up a **fresh test instance of Clawd** from any branch and drive it through Playwright for exploratory E2E testing. This enables a session to validate updates to Clawd itself — login, create sessions, send messages, approve tools, etc. — just like a real user would.

Currently, session containers have **no Docker access** (no Docker CLI, no Docker socket mounted), so they can't create containers. Several changes are needed to make this work safely.

## Changes Required

### 1. Install Docker CLI in Session Image

**File:** `Dockerfile.session`

Add Docker CE CLI installation (lightweight — just the client binary, no daemon) after the GitHub CLI section. Also add `usermod -aG root node` before `USER node` so the node user can access the Docker socket when it's mounted.

```dockerfile
# After the GitHub CLI block (~line 28):

# ── Docker CLI (for sessions that need container management) ──
RUN curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Before USER node (~line 69):
RUN usermod -aG root node
```

The CLI is always installed but only usable when the Docker socket is actually mounted (opt-in per session).

### 2. Add `dockerAccess` Flag to Session Creation

**Files to modify:**

- **`packages/shared/src/api.ts`** — Add `dockerAccess?: boolean` to `CreateSessionRequest`
- **`packages/shared/src/session.ts`** — Add `dockerAccess: boolean` to `SessionInfo`
- **`packages/server/src/sessions/container-manager.ts`** — Add `dockerAccess?: boolean` to `SessionContainerConfig`; conditionally mount Docker socket and set env vars
- **`packages/server/src/sessions/session-manager.ts`** — Accept `dockerAccess` param in `createSession()`, store in `SessionInfo`, pass through to container config
- **`packages/server/src/routes/sessions.ts`** — Extract `dockerAccess` from request body

In `container-manager.ts`, the key change in `createSessionContainer`:
```typescript
if (cfg.dockerAccess) {
  binds.push('/var/run/docker.sock:/var/run/docker.sock');
  env.push('DOCKER_HOST=unix:///var/run/docker.sock');
}
```

### 3. Add Docker Access Checkbox to UI

**File:** `packages/client/src/components/sessions/NewSessionDialog.tsx`

Add a checkbox between the branch selector and the action buttons:
```tsx
<label className="flex items-center gap-3 cursor-pointer">
  <input type="checkbox" checked={dockerAccess} onChange={...} />
  <div>
    <span className="text-sm text-white">Docker access</span>
    <p className="text-xs text-slate-400">Mount Docker socket for container management</p>
  </div>
</label>
```

Pass `dockerAccess` in the `api.createSession()` call.

### 4. Add Instance ID Namespacing (Critical Safety)

When a test Clawd master starts, its `ContainerManager` runs `pruneStaleContainers()` which destroys **all** containers labeled `clawd.session=true` — including the real master's sessions. We must namespace instances.

**Files to modify:**

- **`packages/server/src/config.ts`** — Add `instanceId: process.env.CLAWD_INSTANCE_ID || 'production'`
- **`packages/server/src/sessions/container-manager.ts`**:
  - Container names: `clawd-session-${config.instanceId}-${sessionId}`
  - Labels: add `'clawd.instance.id': config.instanceId`
  - `pruneStaleContainers`: filter by `clawd.instance.id=${config.instanceId}`

### 5. Add Environment-Based Test Credentials

The test Clawd instance needs a way to accept logins without mounting a `credentials.json` file from the host.

**File:** `packages/server/src/routes/auth.ts`

Add fallback: if `CLAWD_TEST_USER` and `CLAWD_TEST_PASSWORD` env vars are set, accept them as valid credentials in addition to the credentials file. This lets the test harness set known credentials:

```typescript
// After loadCredentials():
if (process.env.CLAWD_TEST_USER && process.env.CLAWD_TEST_PASSWORD) {
  credentials.users.push({
    username: process.env.CLAWD_TEST_USER,
    password: process.env.CLAWD_TEST_PASSWORD,
  });
}
```

### 6. Cleanup on Session Termination

When the real master terminates a Docker-access session, clean up any test containers that session created.

**File:** `packages/server/src/sessions/container-manager.ts`

Add `cleanupTestInstances(ownerSessionId)` method that finds and removes containers labeled `clawd.test-instance.owner={sessionId}`. Call it from `stopAndRemove()`.

### 7. Test Harness Script

**New file:** `scripts/test-clawd.sh`

A shell script usable from within any Docker-enabled session that:
1. Verifies Docker access (`docker info`)
2. Verifies images exist (`clawd:latest`, `clawd-session:latest`)
3. Creates a test Clawd master container with:
   - Unique name: `test-clawd-{timestamp}`
   - Unique port (e.g., 5000)
   - `CLAWD_INSTANCE_ID=test-{timestamp}` (prevents prune conflicts)
   - `CLAWD_TEST_USER=test` / `CLAWD_TEST_PASSWORD=test`
   - Docker socket mounted
   - On `clawd-network`
4. Waits for the server to be ready (polls login endpoint)
5. Outputs the URL: `http://test-clawd-{timestamp}:5000`

A corresponding `scripts/cleanup-test-clawd.sh` tears down the test instance and its sessions.

This is intentionally a simple shell script (not a Node package) so any session can use it immediately without building anything.

## How It Works End-to-End

1. User creates a Clawd session with "Docker access" checked
2. Session container starts with Docker socket mounted
3. Inside the session, Claude runs `bash scripts/test-clawd.sh --branch feature-x`
4. Script spins up a test Clawd master on `clawd-network` at `http://test-clawd-xxx:5000`
5. Claude uses Playwright (already installed in session) to navigate to that URL
6. Claude logs in with `test`/`test`, creates sessions, sends messages, approves tools — full exploratory testing
7. When done, Claude runs `bash scripts/cleanup-test-clawd.sh test-clawd-xxx`
8. If the session is terminated without cleanup, the master's `stopAndRemove` handles it

## Files Changed (Summary)

| File | Change |
|------|--------|
| `Dockerfile.session` | Add Docker CLI + `usermod -aG root node` |
| `packages/shared/src/api.ts` | Add `dockerAccess?: boolean` to `CreateSessionRequest` |
| `packages/shared/src/session.ts` | Add `dockerAccess: boolean` to `SessionInfo` |
| `packages/server/src/config.ts` | Add `instanceId` config field |
| `packages/server/src/sessions/container-manager.ts` | Docker socket mounting, instance ID namespacing, test cleanup |
| `packages/server/src/sessions/session-manager.ts` | Accept + pass through `dockerAccess` |
| `packages/server/src/routes/sessions.ts` | Extract `dockerAccess` from request body |
| `packages/server/src/routes/auth.ts` | Add env-based test credentials fallback |
| `packages/client/src/components/sessions/NewSessionDialog.tsx` | Docker access checkbox |
| `scripts/test-clawd.sh` | **New** — spin up test instance |
| `scripts/cleanup-test-clawd.sh` | **New** — tear down test instance |

## Verification

1. **Build session image:** `docker build -f Dockerfile.session -t clawd-session:latest .`
2. **Build master image:** `docker compose build clawd`
3. **Create a session with Docker access enabled** via the UI
4. **Inside the session:** Run `docker info` to confirm Docker access works
5. **Run test instance:** `bash /workspace/scripts/test-clawd.sh`
6. **Playwright test:** Navigate to the test URL, log in, create a session, send a message
7. **Cleanup:** `bash /workspace/scripts/cleanup-test-clawd.sh <container-name>`
8. **Verify isolation:** Confirm the real master's sessions are unaffected (instance ID namespacing)
