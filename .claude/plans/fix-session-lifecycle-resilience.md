# Fix: Session Lifecycle Resilience

**Branch:** `fix/session-lifecycle-resilience`

Addresses two related issues where session lifecycle failures leave the UI stuck with no feedback.

---

## Issue #167: SDK runner `queryTurnDone` promise never resolves if SDK crashes mid-turn

### Problem

In `packages/session-agent/src/sdk-runner.ts`, `sendUserMessage()` (line 228) creates a `queryTurnDone` promise (line 256) that only resolves when `handleSDKMessage` processes a `result` message (line 839-843). If the SDK crashes or the `for await` loop in `run()` exits with an error mid-turn, `resolveQueryTurn` is never called. This leaves the promise hanging forever, which means:

1. Any subsequent `sendUserMessage()` call will `await this.queryTurnDone` (line 235) and hang indefinitely.
2. The session appears stuck to the user — no error feedback, no way to send new messages.

### Fix

In the `run()` method's `catch` block (line 448) and after the `for await` loop exits normally (line 447), resolve any pending `queryTurnDone` promise so the next message attempt can proceed (or at least fail cleanly).

### Files to Change

**`packages/session-agent/src/sdk-runner.ts`**

1. Add a `finally` block (or augment the existing `catch`) in the `run()` method that cleans up the turn state:
   ```typescript
   // After the for-await loop and in the catch block, add:
   finally {
     // Ensure any pending queryTurnDone promise is resolved so
     // sendUserMessage() doesn't hang forever if the SDK exits mid-turn.
     this.queryTurnInProgress = false;
     if (this.resolveQueryTurn) {
       this.resolveQueryTurn();
       this.resolveQueryTurn = null;
     }
   }
   ```
   This is safe because if the `result` message already resolved it, `resolveQueryTurn` will be `null` and the code is a no-op.

2. Convert the existing `catch` + new cleanup into `try/catch/finally`:
   - The `catch` block stays as-is (sends error status and error message to master).
   - The `finally` block resolves the pending turn promise unconditionally.

### Risks

- **Low risk.** The `finally` cleanup is idempotent — if the turn already resolved via the normal `result` path, `resolveQueryTurn` is already `null`. No double-resolve possible.
- The `catch` block already sends `status_update: error` to the master, so the UI will transition out of "running" state. The `finally` block just ensures the internal promise doesn't hang.

---

## Issue #170: No timeout or error feedback when session container fails to start

### Problem

When `createSession()` in `session-manager.ts` calls `startContainer()` (line 154), it does so asynchronously with `.catch()` for errors. The `.catch()` handler (line 155) correctly sets the session to `error` status if container creation fails (e.g., Docker errors, image not found). **However**, there are failure modes not covered:

1. **Container starts but exits immediately** (e.g., entrypoint script crashes, git clone fails, node process exits). The container is created and started successfully, so `createSessionContainer()` returns without error. But the agent process never connects via WebSocket, so the session stays in `starting` status forever.

2. **Container starts, agent connects, but SDK initialization fails silently.** The `ready` message is never sent, session stays in `starting`.

There is no timeout on the `starting` state — the UI shows "Starting" indefinitely.

### Fix

Add a **startup timeout** that detects when a session has been in `starting` status for too long without the agent connecting.

### Files to Change

**`packages/server/src/sessions/session-manager.ts`**

1. Add a startup timeout constant at the top:
   ```typescript
   // Max time to wait for a session container to connect and report ready.
   const STARTUP_TIMEOUT_MS = 120_000; // 2 minutes
   ```

2. In `createSession()`, after calling `this.startContainer(session)`, schedule a timeout check:
   ```typescript
   // After the startContainer().catch() block (line 154-165), add:
   setTimeout(() => {
     const s = this.sessions.get(id);
     if (s && s.info.status === 'starting') {
       console.error(`[session:${id}] Startup timeout — container did not become ready within ${STARTUP_TIMEOUT_MS}ms`);
       this.updateStatus(s, 'error');
       this.addMessage(s, {
         id: uuid(),
         sessionId: id,
         type: 'error',
         content: 'Session startup timed out. The container may have failed to start or the agent could not connect.',
         timestamp: new Date().toISOString(),
       });
       this.scheduleEviction(id);
     }
   }, STARTUP_TIMEOUT_MS);
   ```

3. **Also** add container exit detection in `ContainerManager`. Add a `waitForExit()` method that uses dockerode's `container.wait()` to detect early container death, and expose a callback:

**`packages/server/src/sessions/container-manager.ts`**

4. Add a method to monitor a container for unexpected exit:
   ```typescript
   /**
    * Watch a container for exit. Calls the callback with the exit code
    * if the container stops. Returns a cleanup function to stop watching.
    */
   watchForExit(sessionId: string, onExit: (exitCode: number) => void): () => void {
     const containerId = this.containers.get(sessionId);
     if (!containerId) return () => {};

     const container = this.docker.getContainer(containerId);
     let cancelled = false;

     container.wait().then((result) => {
       if (!cancelled) {
         onExit(result.StatusCode);
       }
     }).catch(() => {
       // Container may have been removed already
     });

     return () => { cancelled = true; };
   }
   ```

5. Back in **`session-manager.ts`**, use `watchForExit` in `startContainer()` to detect early container death:
   ```typescript
   // After container is created successfully, watch for exit:
   const cancelWatch = this.containerManager.watchForExit(session.info.id, (exitCode) => {
     const s = this.sessions.get(session.info.id);
     if (s && (s.info.status === 'starting' || s.info.status === 'idle' || s.info.status === 'running')) {
       console.error(`[session:${session.info.id}] Container exited unexpectedly with code ${exitCode}`);
       this.updateStatus(s, 'error');
       this.addMessage(s, {
         id: uuid(),
         sessionId: session.info.id,
         type: 'error',
         content: `Session container exited unexpectedly (exit code: ${exitCode})`,
         timestamp: new Date().toISOString(),
       });
       this.scheduleEviction(session.info.id);
     }
   });
   ```

   Store the cancel function on `ManagedSession` so it can be cleaned up on terminate/delete:
   ```typescript
   // Add to ManagedSession interface:
   cancelContainerWatch: (() => void) | null;
   ```

   Call `cancelContainerWatch()` in `terminateSession()` and `deleteSession()` before stopping the container.

### Risks

- **Docker `container.wait()`** is a long-poll HTTP call to the Docker daemon. It's lightweight but we need to ensure we cancel/ignore it when the session is intentionally terminated. The `cancelled` flag handles this.
- **Startup timeout of 2 minutes** is generous enough for slow git clones but short enough to give meaningful feedback. Could be made configurable via `config` later if needed.
- The timeout and the container watch are complementary — the timeout catches cases where the container is still running but the agent is stuck (e.g., hanging on git clone), while the watch catches cases where the container exits quickly.

---

## Implementation Order

1. **#167 first** — single file change, isolated, low risk.
2. **#170 second** — touches two files, slightly more involved.
3. Test both by:
   - Verifying normal session flow still works.
   - Simulating SDK crash (kill the node process in a container) to verify #167 fix.
   - Creating a session with an invalid repo URL to verify #170 timeout/exit detection.

## Files Summary

| File | Changes |
|------|---------|
| `packages/session-agent/src/sdk-runner.ts` | Add `finally` block to `run()` to resolve pending `queryTurnDone` |
| `packages/server/src/sessions/container-manager.ts` | Add `watchForExit()` method |
| `packages/server/src/sessions/session-manager.ts` | Add startup timeout, integrate container exit watching, add `cancelContainerWatch` to `ManagedSession` |
