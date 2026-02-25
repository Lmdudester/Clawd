# Fix Sessions with auto_edits Permission Mode

## Context

Manager-created fix sessions currently run in `normal` permission mode, requiring approval for every file edit. This slows down fix sessions unnecessarily. The `permissionMode` field was already added to `CreateSessionRequest` and the route handles it, but the manager doesn't know to use it. Rather than hard-coding server-side heuristics, we instruct the manager prompt to pass `"permissionMode": "auto_edits"` when creating fix sessions.

## Changes

### 1. Revert hard-coded `currentStep` check in `packages/server/src/routes/sessions.ts`

Remove lines 73-77 (the fix-phase auto-detection block). The `permissionMode` field on the API (lines 64-67) stays — that's what the manager will use.

### 2. Update manager prompt in `packages/session-agent/src/manager-prompt.ts`

**Line 20 — API docs:** Add `permissionMode` to the session creation payload:
```
- POST /api/sessions — Create session: { "name": "...", "repoUrl": "...", "branch": "...", "permissionMode": "normal" | "auto_edits" }
```

**Lines 98-101 — Step 2 (Fix) instructions:** Tell the manager to pass `"permissionMode": "auto_edits"` when creating fix sessions.

**Line 156 — "How Supervision Works":** Update the sentence "Child sessions run in normal permission mode" to note that fix sessions use `auto_edits`.

## Verification

1. `npx tsc --noEmit -p packages/server/tsconfig.json` — type check
2. Rebuild shared package if needed
3. Read the final prompt to confirm the instructions are clear
