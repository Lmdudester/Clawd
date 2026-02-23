# Plan: Session State Persistence Across Server Restarts

- **Branch:** `enhance/session-resilience`
- **Issues:** #64

## Summary

Add file-based JSON persistence for session metadata and message history so that sessions survive server restarts. On startup, the server reloads persisted sessions and re-attaches to still-running containers instead of pruning them. This follows the existing project pattern (credential-store, project-repos) of using simple JSON files for persistence — no new dependencies like SQLite.

## Problem Analysis

When the master server restarts (including via the auto-update in `entrypoint.sh`):

1. The `sessions` Map in `SessionManager` is empty — all session metadata is lost.
2. All message history is gone.
3. `internalSecret` in `config.ts` is regenerated (`randomBytes(32).toString('hex')`), so surviving containers can't reconnect — their WebSocket URL contains the old secret.
4. `ContainerManager.pruneStaleContainers()` kills all running session containers on startup.
5. Clients that reconnect see no sessions.

## Files to Change

### 1. `packages/server/src/config.ts`
- **Add** a `sessionStorePath` config value pointing to a JSON file (e.g., `resolve(projectRoot, 'session-store.json')`).
- **Change** `internalSecret` to be persistent: read from `INTERNAL_SECRET` env var or from a persisted file, falling back to random generation on first run. This is critical — without a stable secret, surviving containers can never reconnect.

### 2. `packages/server/src/sessions/session-store.ts` (new file)
- **Create** a `SessionStore` class responsible for reading/writing session state to disk.
- Follow the same pattern as `CredentialStore` and `ProjectRepoStore`: synchronous `readFileSync`/`writeFileSync` on a JSON file.
- Data structure:
  ```ts
  interface PersistedState {
    sessions: PersistedSession[];
    internalSecret: string;
  }

  interface PersistedSession {
    info: SessionInfo;
    messages: SessionMessage[];
    sessionToken: string;
    containerId: string | null;
    managerApiToken: string | null;
    managerState: ManagerState | null;
  }
  ```
- Methods:
  - `load(): PersistedState | null` — read from disk, return null if file doesn't exist or is corrupt.
  - `save(state: PersistedState): void` — write to disk atomically (write to `.tmp` then rename).
  - `delete(): void` — remove the file.

### 3. `packages/server/src/sessions/session-manager.ts`
- **Add** a `SessionStore` dependency (injected via constructor or created internally).
- **Add** `persistSession(sessionId)` private method — serializes a single session's persistable state and triggers a full save. Called on:
  - Status changes (`updateStatus`)
  - New messages (`addMessage`)
  - Session creation (`createSession`)
  - Settings updates (`updateSessionSettings`)
  - Session info updates (`handleAgentMessage` — `session_info_update`)
- **Add** `persistAll()` private method — saves all sessions at once.
- **Add** `restoreSessions()` method — called during startup:
  1. Load persisted state from `SessionStore`.
  2. For each persisted session:
     - Skip sessions with status `terminated` or `error` (don't resurrect dead sessions).
     - Re-create the `ManagedSession` object in the `sessions` Map with `agentWs: null`, `pendingApproval: null`, `pendingQuestion: null`.
     - Set status to `reconnecting` (new status) to indicate the session is waiting for its container to reconnect.
  3. Return the list of restored session IDs for container re-attachment.
- **Add** `handleReconnectedAgent(sessionId)` — when a restored session's container reconnects, transition status from `reconnecting` to `idle`.
- **Modify** `deleteSession()` — also remove the session from the persisted store.
- **Modify** eviction logic — remove persisted data when a session is evicted.
- **Debounce** persistence writes — use a simple dirty-flag + `setTimeout` (e.g., 1 second) to batch rapid updates and avoid excessive disk I/O during streaming.

### 4. `packages/shared/src/session.ts`
- **Add** `'reconnecting'` to the `SessionStatus` union type so the client can display a "reconnecting" state.

### 5. `packages/server/src/sessions/container-manager.ts`
- **Modify** `initialize()` — accept a list of session IDs that should be preserved (restored sessions with still-running containers). `pruneStaleContainers()` should skip containers whose `clawd.session.id` label matches a restored session.
- **Add** `reattachContainer(sessionId, containerId)` method — register an existing container in the `containers` Map without creating/starting it. Used during restore when the container is already running.
- **Modify** `pruneStaleContainers()` — accept a `Set<string>` of session IDs to keep. Only prune containers whose session ID is NOT in that set.
- **Add** `findRunningContainers()` method — list all running containers with `clawd.session=true` and `clawd.instance.id` matching, returning a map of `sessionId -> containerId`. Used during restore to match persisted sessions to live containers.

### 6. `packages/server/src/index.ts`
- **Modify** startup sequence:
  1. Load persisted state (including the saved `internalSecret`) before creating the `ContainerManager`.
  2. Set `config.internalSecret` to the persisted value (or generate and persist a new one on first run).
  3. Call `containerManager.initialize(restoredSessionIds)` so it doesn't prune restored containers.
  4. Call `sessionManager.restoreSessions()` to reload sessions into memory.
  5. Match restored sessions to running containers via `containerManager.findRunningContainers()`.
  6. For each matched session, call `containerManager.reattachContainer()`.
  7. For restored sessions whose containers are gone, mark as `error` and schedule eviction.
- **Add** periodic persistence on `SIGTERM`/`SIGINT` — call `sessionManager.persistAll()` before shutting down containers.

### 7. `packages/client/src/components/` (minor UI update)
- Handle the `reconnecting` status in the session status badge — display it similarly to `starting` with a "Reconnecting..." label. This is a single-line addition to the status mapping.

## Implementation Approach

### Step 1: Stable Internal Secret
Make `internalSecret` persistent so surviving containers can reconnect after a restart. Read from env var `INTERNAL_SECRET` if set, otherwise read from/write to the session store file. This is the foundational change — without it, container re-attachment is impossible.

### Step 2: Session Store
Create `session-store.ts` following the `ProjectRepoStore` pattern. Keep it simple: one JSON file, synchronous I/O with atomic writes (write to temp file, then `renameSync`).

### Step 3: Persistence Hooks in SessionManager
Add `persistSession()` calls at key state-change points. Use a debounce mechanism (dirty flag + 1s timer) to coalesce rapid updates. Add `persistAll()` for clean shutdown.

### Step 4: Restore Logic in SessionManager
Implement `restoreSessions()` that loads persisted sessions and re-populates the `sessions` Map. Sessions come back with `reconnecting` status and no WebSocket.

### Step 5: Container Re-attachment
Modify `ContainerManager` to support discovering and re-attaching to existing containers instead of always pruning them. The key is matching `clawd.session.id` labels to restored session IDs.

### Step 6: Startup Orchestration
Wire everything together in `index.ts`: load state → set secret → init containers (with skip list) → restore sessions → match containers → mark orphaned sessions as error.

### Step 7: Reconnecting Status
Add `'reconnecting'` to shared types. When a container's agent WebSocket reconnects to the master, the `registerAgentConnection` flow should detect the `reconnecting` status and transition to `idle`. The agent already sends a `ready` message on connect, which triggers `updateStatus(session, 'idle')`, so this largely works already — but we should add a system message indicating the session was restored.

### Step 8: Graceful Shutdown Persistence
On `SIGTERM`/`SIGINT`, persist all sessions *before* stopping containers. This way the next startup has fresh state. Also skip container teardown on restart (only tear down on explicit shutdown/terminate) — this requires distinguishing "server restart" from "full shutdown". For now, always persist state and let the next startup sort out which containers are still alive.

## Risks and Considerations

1. **Atomic writes**: JSON file writes must be atomic (write to temp + rename) to avoid corruption if the server crashes mid-write. The existing stores don't do this — we should, given session data is more valuable.

2. **Stale container cleanup**: If a container dies while the server is down, the restored session will have a `containerId` but no running container. The startup logic must detect this (via `docker inspect`) and mark those sessions as `error`.

3. **Internal secret stability**: The current `internalSecret` is regenerated each startup. Making it persistent means it must be stored securely. The session store file (same as credentials.json) is acceptable for this self-hosted context.

4. **Message volume**: Sessions can accumulate up to 500 messages. For many concurrent sessions, the JSON file could grow large. The 500-message cap keeps this bounded. At ~1KB per message, 50 sessions × 500 messages = ~25MB worst case, which is fine for file-based storage.

5. **Race conditions on persist**: Multiple rapid state changes (e.g., during streaming) could cause excessive writes. The debounce timer (1s) handles this. We persist the full state each time rather than individual session diffs to keep the logic simple.

6. **Container network**: Containers connect to the master via `ws://clawd:3050/internal/session?secret=...`. The hostname (`clawd`) and port must remain stable across restarts. They already are (Docker network + container name). The secret is the only volatile piece, which this plan fixes.

7. **Shutdown vs restart**: The current shutdown handler calls `containerManager.shutdown()` which stops all containers. For restart resilience, we need to *not* kill containers on restart. This could be handled by:
   - Adding a `--restart` flag or signal that skips container teardown.
   - Or simpler: always persist state, always try to re-attach on startup, and let the existing graceful shutdown (SIGINT/SIGTERM) continue killing containers when the user explicitly stops the server. The entrypoint.sh `exec npm start` means the Node process gets SIGTERM directly, so this works.
   - The entrypoint.sh auto-update flow would need to send a different signal or set an env var to indicate "restart" vs "stop", but this is out of scope for the initial implementation.

## Issues to Skip

- **Auto-update restart flow**: The `entrypoint.sh` currently does a full restart. Making the auto-update preserve containers (e.g., via a "restart" signal instead of process replacement) is a separate enhancement.
- **Multi-instance coordination**: If multiple Clawd instances share a Docker host, they already isolate via `instanceId`. No changes needed.
- **Message streaming recovery**: If the agent was mid-stream when the server restarted, resuming the stream is not feasible. The session will be in `reconnecting` state and the user can send a new message.
- **Pending approvals/questions**: These are not persisted. If the agent was awaiting approval when the server restarted, the user will need to re-trigger the action. Persisting transient interaction state adds complexity for little benefit.
- **SQLite migration**: The project consistently uses JSON files for persistence. Introducing SQLite would add a dependency and diverge from established patterns. If scale becomes an issue, this can be revisited later.
