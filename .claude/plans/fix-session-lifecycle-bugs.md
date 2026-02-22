# Plan: Fix Session Lifecycle & Resource Leak Bugs

**Branch:** `fix/session-lifecycle-bugs`
**Issues:** #159, #158, #160, #129

---

## Issue #159: Failed container startups never scheduled for eviction

**Problem:** When `startContainer()` fails, the catch handler at `session-manager.ts:147-157` sets status to `error` but never calls `scheduleEviction()`. These sessions persist in the in-memory `sessions` map indefinitely. Similarly, `unregisterAgentConnection()` at line 260-277 marks sessions as `error` on unexpected disconnect but doesn't schedule eviction either.

**Files to change:**
- `packages/server/src/sessions/session-manager.ts`

**Implementation:**

1. In the `startContainer().catch()` handler (line 147-157), add `this.scheduleEviction(id)` after the error message is added:
   ```typescript
   this.startContainer(session).catch((err) => {
     console.error(`[session:${id}] Container startup failed:`, err);
     this.updateStatus(session, 'error');
     this.addMessage(session, { /* ... */ });
     this.scheduleEviction(id);  // <-- ADD
   });
   ```

2. In `unregisterAgentConnection()` (line 260-277), add `this.scheduleEviction(sessionId)` after setting status to `error`:
   ```typescript
   if (session.info.status !== 'terminated' && session.info.status !== 'error') {
     this.updateStatus(session, 'error');
     this.addMessage(session, { /* ... */ });
     this.scheduleEviction(sessionId);  // <-- ADD
   }
   ```

**Risks:** Low. `scheduleEviction()` already cancels any existing timer first (line 665), so calling it multiple times is safe. The 5-minute TTL gives users time to see the error state before the session is cleaned up.

---

## Issue #158: deleteSession does not clear managerContinueTimer

**Problem:** `deleteSession()` at line 635-662 does not clear `session.managerContinueTimer` before removing the session from the map. If a 3-second auto-continue timer is pending, it fires after deletion. While the `this.sessions.get()` guard at line 701 causes an early return, the orphaned timer holds a reference to the session object and creates a race window.

**Files to change:**
- `packages/server/src/sessions/session-manager.ts`

**Implementation:**

Add timer cleanup at the start of `deleteSession()`'s inner `cleanup` function (line 649), matching what `terminateSession()` already does at lines 612-616:

```typescript
const cleanup = async () => {
  // Clear auto-continue timer
  if (session.managerContinueTimer) {
    clearTimeout(session.managerContinueTimer);
    session.managerContinueTimer = null;
  }
  this.updateStatus(session, 'terminated');
  session.agentWs?.close();
  session.agentWs = null;
  await this.containerManager.stopAndRemove(sessionId);
  this.sessions.delete(sessionId);
};
```

**Risks:** None. This is a direct copy of existing cleanup logic from `terminateSession()`. The timer may or may not exist — `clearTimeout(null)` is a no-op, but we guard with `if` anyway for clarity.

---

## Issue #160: closeChannel resolves pending waiters with done:false

**Problem:** In `sdk-runner.ts`, `closeChannel()` (line 219-225) resolves pending async iterator waiters with `undefined`, but the waiter's resolve wrapper (line 198) wraps this as `{ value: undefined, done: false }`. The SDK's `for await` loop doesn't terminate and passes `undefined` to `handleSDKMessage()`, which crashes accessing `message.type` on undefined.

This happens when `abort()` is called while the SDK is waiting for a new user message — the waiter resolves with a non-terminating iterator result containing undefined.

**Files to change:**
- `packages/session-agent/src/sdk-runner.ts`

**Implementation:**

Two coordinated changes to the message channel:

1. **Change the waiter type** to resolve with a full `IteratorResult` instead of just the message value. Update the `messageQueue` type (line 183) and the `next()` method (lines 196-200):

   ```typescript
   private messageQueue: Array<{ resolve: (result: IteratorResult<any>) => void }> = [];
   ```

   ```typescript
   return new Promise((resolve) => {
     this.messageQueue.push({ resolve });
   });
   ```

2. **Update `pushToChannel()`** (line 205-217) to wrap the message in a non-done result when resolving a waiter:

   ```typescript
   if (this.messageQueue.length > 0) {
     const waiter = this.messageQueue.shift()!;
     waiter.resolve({ value: message, done: false });
   }
   ```

3. **Update `closeChannel()`** (line 219-225) to resolve with a done result:

   ```typescript
   private closeChannel(): void {
     this.channelClosed = true;
     for (const waiter of this.messageQueue) {
       waiter.resolve({ value: undefined, done: true });
     }
     this.messageQueue = [];
   }
   ```

**Risks:** Low. The change is localized to the internal async iterator protocol. The `for await` loop at line 446 will now terminate cleanly when `closeChannel()` is called, instead of passing `undefined` to `handleSDKMessage()`. The `channelClosed` guard at line 193 still handles new `next()` calls after close.

---

## Issue #129: Managed sessions often lack OAuth key

**Problem:** Managed child sessions frequently start without a valid OAuth token. In `startContainer()` (line 217-239), `ensureFreshToken()` can return `null` when:
- The token is expired and refresh fails (network error, refresh cooldown, no refresh token)
- No stored auth exists at all

When `ensureFreshToken()` returns `null`, `oauthToken` becomes `undefined`, and the container starts without the `CLAUDE_CODE_OAUTH_TOKEN` env var. While `.credentials.json` is volume-mounted read-only, the token inside it may itself be expired — and the container can't refresh it since the mount is read-only.

The `broadcastTokenUpdate()` mechanism pushes refreshed tokens to connected sessions, but sessions that haven't connected their WebSocket yet (still starting up) miss these broadcasts.

**Files to change:**
- `packages/server/src/sessions/session-manager.ts`

**Implementation:**

Add a warning log and retry logic in `startContainer()` when `ensureFreshToken()` returns null:

```typescript
private async startContainer(session: ManagedSession): Promise<void> {
  const claudeDir = this.credentialStore.getSelectedClaudeDir();
  let oauthToken = (await this.credentialStore.ensureFreshToken()) ?? undefined;

  // If token is unavailable, wait briefly and retry once — covers transient
  // refresh failures and cooldown windows that are common when multiple
  // child sessions start concurrently.
  if (!oauthToken) {
    console.warn(`[session:${session.info.id}] OAuth token unavailable, retrying after delay...`);
    await new Promise((r) => setTimeout(r, 5000));
    oauthToken = (await this.credentialStore.ensureFreshToken()) ?? undefined;
    if (!oauthToken) {
      console.warn(`[session:${session.info.id}] OAuth token still unavailable — container will start without it`);
    }
  }

  // ... rest of container config ...
}
```

Additionally, in `registerAgentConnection()` (line 249-257), push the current token to the newly connected agent immediately so it always has the latest token regardless of what was available at container creation time:

```typescript
registerAgentConnection(sessionId: string, ws: WebSocket): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;
  if (session.agentWs && session.agentWs !== ws) {
    console.warn(`[session:${sessionId}] Replacing existing agent WebSocket — closing old connection`);
    session.agentWs.close();
  }
  session.agentWs = ws;
  console.log(`[session:${sessionId}] Agent WebSocket registered`);

  // Push current OAuth token to newly connected agent — covers the case
  // where the token was unavailable or stale at container creation time
  // but has since been refreshed.
  const currentToken = this.credentialStore.getAccessToken();
  if (currentToken) {
    this.sendToAgent(sessionId, { type: 'token_update', token: currentToken });
  }
}
```

**Risks:** Medium-low.
- The 5-second retry delay adds latency to session startup only when the token is unavailable — the common path (token available) is unchanged.
- Pushing the token on agent connect is safe — the agent's `token_update` handler just sets `process.env.CLAUDE_CODE_OAUTH_TOKEN`.
- There's a theoretical race where `getAccessToken()` returns a token that expires moments later, but the proactive refresh mechanism and `broadcastTokenUpdate()` handle ongoing refreshes.
- Note: `getAccessToken()` is synchronous (reads from file) while `ensureFreshToken()` is async (may trigger refresh). Using `getAccessToken()` in `registerAgentConnection` is intentional — we just want the current best-effort token, not to block registration on a refresh.

---

## Summary

| Issue | Severity | Complexity | Approach |
|-------|----------|-----------|----------|
| #159 — Eviction for failed startups | Medium | Trivial | Add `scheduleEviction()` in 2 places |
| #158 — Clear timer on delete | Low | Trivial | Add timer cleanup to `deleteSession()` |
| #160 — closeChannel done:false | High | Low | Fix async iterator protocol in channel |
| #129 — Missing OAuth token | High | Low-Medium | Retry + push token on agent connect |

All four fixes are independent and can be implemented in any order. None require changes to shared types or the client package. The total diff should be under 40 lines of new/changed code.
