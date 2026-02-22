# Plan: Client React Performance Fixes

**Branch:** `fix/client-react-performance`
**Issues:** #55, #81, #77, #74

---

## Issue #55: Streaming text selector iterates all streaming tokens on every render

**File:** `packages/client/src/components/chat/ChatView.tsx` (lines 132-137)
**Related:** `packages/client/src/stores/sessionStore.ts` (streamingTokens Map)

### Problem

The Zustand selector in `ChatView` iterates the entire `streamingTokens` Map on every store update:

```ts
const streamingText = useSessionStore((s) => {
  for (const [key, value] of s.streamingTokens) {
    if (key.startsWith(`${id}:`)) return value;
  }
  return '';
});
```

Zustand calls this selector on **every** state change (not just streamingTokens changes). Since the Map is keyed as `${sessionId}:${messageId}`, the selector must iterate to find the right entry. This causes unnecessary work on every unrelated store update (e.g., session list changes, pending approvals).

### Implementation

**Approach:** Add a derived `streamingTextBySession` Map to the store that is maintained alongside `streamingTokens`. This provides O(1) lookup by session ID.

1. **`packages/client/src/stores/sessionStore.ts`:**
   - Add `streamingTextBySession: Map<string, string>` to `SessionState` interface and initial state.
   - In `appendStreamToken`: after updating `streamingTokens`, also update `streamingTextBySession` by concatenating the token for the given `sessionId`. This is a derived aggregation — concatenate all values for keys matching the sessionId prefix.
   - In `clearStreamTokens`: after deleting from `streamingTokens`, recompute or clear the `streamingTextBySession` entry for that session.
   - In `clearSessionStreamTokens`: delete the entry from `streamingTextBySession`.
   - In `removeSession`: delete from `streamingTextBySession`.

2. **`packages/client/src/components/chat/ChatView.tsx`:**
   - Replace the iterator-based selector with:
     ```ts
     const streamingText = useSessionStore(
       useCallback((s) => s.streamingTextBySession.get(id ?? '') ?? '', [id])
     );
     ```
   - The `useCallback` ensures the selector function is stable across renders (since it closes over `id`), which is important for Zustand's reference equality check.

### Risks

- Low risk. The `streamingTextBySession` Map is a straightforward derived state.
- Need to ensure consistency between `streamingTokens` and `streamingTextBySession` in all mutation paths (append, clear, clearSession, removeSession). A helper function that recomputes the session text from `streamingTokens` entries would be safer than manual bookkeeping.

---

## Issue #81: ToolCallCard memo lacks custom equality — re-renders on same props

**Files:**
- `packages/client/src/components/chat/ToolCallCard.tsx` (line 13)
- `packages/client/src/components/chat/ToolGroup.tsx` (line 40)
- `packages/client/src/components/chat/MessageList.tsx` (line 19)

### Problem

`ToolCallCard` uses `memo()` with default shallow equality. The `message` and `result` props are `SessionMessage` objects. If the parent (`ToolGroup`) re-renders with new object references that have identical content, `memo` won't prevent the re-render.

The chain is: store update -> `messages` reference changes -> `groupMessages()` creates new arrays in `useMemo` -> `ToolGroup` receives new `messages` array -> `pairToolMessages` creates new `ToolPair` objects -> `ToolCallCard` receives new `message`/`result` object references.

However, looking more closely: `MessageList.useMemo` depends on `[messages]`, and the `messages` reference from the store only changes when messages for that session actually change (it's from a `Map.get()`). So `groupMessages` only re-runs when messages genuinely change. The real concern is when new messages are *appended* — `groupMessages` re-runs, creates new segment objects for ALL groups (not just the new ones), and `ToolGroup` gets new array references even though its specific messages haven't changed.

### Implementation

**Approach:** Add a custom equality function to `ToolCallCard`'s `memo()` that compares by message ID (which is stable and unique).

1. **`packages/client/src/components/chat/ToolCallCard.tsx`:**
   - Add a custom comparator to `memo()`:
     ```ts
     export const ToolCallCard = memo(function ToolCallCard({ message, result }: Props) {
       // ...
     }, (prev, next) =>
       prev.message.id === next.message.id &&
       prev.result?.id === next.result?.id
     );
     ```
   - This works because message content is immutable once created — if the ID is the same, the content is the same.

2. **`packages/client/src/components/chat/ToolGroup.tsx`:**
   - Add a custom comparator to the existing `memo()`:
     ```ts
     export const ToolGroup = memo(function ToolGroup({ messages }: Props) {
       // ...
     }, (prev, next) => {
       if (prev.messages.length !== next.messages.length) return false;
       for (let i = 0; i < prev.messages.length; i++) {
         if (prev.messages[i].id !== next.messages[i].id) return false;
       }
       return true;
     });
     ```

### Risks

- Low risk. The assumption that message IDs are stable and content-immutable is core to how the store works (deduplication by ID in `addMessages` and `setMessages`).
- The custom equality on `ToolGroup` adds an O(n) comparison per render check, but tool groups are typically small (< 20 messages), so this is negligible.

---

## Issue #77: useUsage hook polling interval is not cleaned up on unmount

**File:** `packages/client/src/hooks/useUsage.ts`

### Problem

The issue title says the hook has a polling interval that isn't cleaned up. However, **looking at the actual code, there is no polling interval.** The hook:

1. Uses a module-level cache (`cachedUsage`) shared across all hook instances.
2. Fetches once on mount if no cached data exists (via `useEffect` + `refresh()`).
3. Provides a manual `refresh` function for the consumer.
4. Uses a `listeners` Set for cross-instance reactivity — cleaned up properly in the `useEffect` return.

There is **no `setInterval`** in this hook. The listener cleanup is correct. The `fetchPromise` guard prevents duplicate concurrent requests.

### Assessment: Skip this issue

The code does not have the bug described. The `useEffect` cleanup properly removes the listener from the Set. There is no interval to leak. The only potential issue is if `setLoading(false)` is called after unmount (inside the `.finally()` of the fetch), but this is a React no-op in React 18+ and harmless.

If the issue was filed based on an earlier version of the code that did have a polling interval, that code has already been fixed/removed.

**Recommendation:** Close issue #77 as "not applicable" — the current implementation has no polling interval and properly cleans up its listener.

---

## Issue #74: SettingsDialog calls onRequestModels on every open — no cache

**File:** `packages/client/src/components/chat/SettingsDialog.tsx` (lines 44-52)

### Problem

Every time the dialog opens, `onRequestModels()` fires a WebSocket message to fetch models from the session agent. Models don't change during a session, so this is unnecessary after the first successful fetch.

```ts
useEffect(() => {
  if (open) {
    setModelsTimedOut(false);
    onRequestModels();
    const timer = setTimeout(() => setModelsTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }
}, [open, onRequestModels]);
```

### Implementation

**Approach:** Skip the model request if models are already loaded. The `availableModels` prop is already passed to the component.

1. **`packages/client/src/components/chat/SettingsDialog.tsx`:**
   - Modify the `useEffect` to check if models are already available:
     ```ts
     useEffect(() => {
       if (!open) return;
       // Models don't change during a session — skip if already loaded
       if (availableModels.length > 0) return;
       setModelsTimedOut(false);
       onRequestModels();
       const timer = setTimeout(() => setModelsTimedOut(true), 5000);
       return () => clearTimeout(timer);
     }, [open, availableModels.length, onRequestModels]);
     ```

### Risks

- Very low risk. If the models list is empty (e.g. the first request failed or timed out), the next dialog open will retry — which is the desired behavior.
- Edge case: if the session agent returns an empty models list (no models available), this would cause repeated requests. This is unlikely in practice, and if it happens, the 5-second timeout + timed-out fallback UI already handles it gracefully.

---

## Summary

| Issue | Fix? | Complexity | Files Changed |
|-------|------|-----------|---------------|
| #55 — Streaming selector iterates all tokens | Yes | Medium | `sessionStore.ts`, `ChatView.tsx` |
| #81 — ToolCallCard memo lacks custom equality | Yes | Low | `ToolCallCard.tsx`, `ToolGroup.tsx` |
| #77 — useUsage polling interval leak | **Skip** | N/A | N/A — bug does not exist in current code |
| #74 — SettingsDialog re-fetches models | Yes | Low | `SettingsDialog.tsx` |

### Implementation Order

1. **#74** (SettingsDialog) — smallest, self-contained change
2. **#81** (ToolCallCard/ToolGroup memo) — small, two files, no store changes
3. **#55** (Streaming selector) — medium, involves store schema change
4. Close **#77** with explanation
