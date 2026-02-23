# Plan: Replace native confirm() with styled confirmation dialog

**Branch:** `fix/ui-refinements`
**Issue:** #171 — Session close uses native browser `confirm()` instead of styled modal

## Problem

When clicking the close (X) button on a session card, the app calls `window.confirm()` which renders a browser-native dialog. This is inconsistent with the rest of the UI, which uses custom styled modals (e.g., `NewSessionDialog`, `SettingsDialog`).

## Implementation Approach

Create a reusable `ConfirmDialog` component following the exact patterns established by `NewSessionDialog` and `SettingsDialog`, then use it in `SessionCard` to replace the `window.confirm()` call.

### Files to Change

#### 1. **New file: `packages/client/src/components/common/ConfirmDialog.tsx`**

Create a reusable confirmation dialog component with:
- **Props:** `open: boolean`, `title: string`, `message: string`, `confirmLabel?: string` (default "Delete"), `cancelLabel?: string` (default "Cancel"), `onConfirm: () => void`, `onCancel: () => void`, `variant?: 'danger' | 'default'` (controls confirm button color)
- **Structure:** Same modal pattern as `NewSessionDialog`:
  - Fixed backdrop (`bg-black/60`, `z-50`) with click-outside-to-close
  - Centered dialog card (`bg-slate-800`, `rounded-2xl`, `border-slate-700`)
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
  - Focus trap (tab cycling between Cancel and Confirm buttons)
  - Escape key closes the dialog
  - Two-button footer: Cancel (secondary, `bg-slate-700`) and Confirm (primary, `bg-red-600` for danger variant, `bg-blue-600` for default)
- Keep the component simple — no form, no loading states. Just title, message, and two buttons.

#### 2. **Modify: `packages/client/src/components/sessions/SessionCard.tsx`**

- Add `useState<boolean>` for `confirmOpen` (controls dialog visibility)
- Replace the `handleClose` logic:
  - **Before:** Calls `window.confirm()` synchronously, then proceeds with deletion
  - **After:** Sets `confirmOpen = true` to show the `ConfirmDialog`. The actual deletion logic moves to `handleConfirmDelete` (called from `onConfirm` callback).
- Add `<ConfirmDialog>` render at the end of the component's JSX with:
  - `title="Delete session"`
  - `message={`Delete session "${session.name}"?`}`
  - `confirmLabel="Delete"`
  - `variant="danger"`
  - `onConfirm={handleConfirmDelete}` — performs the existing delete logic (optimistic remove, API call, rollback on error)
  - `onCancel={() => setConfirmOpen(false)}`

**Specific changes in `SessionCard.tsx`:**

```diff
+ import { useState } from 'react';
+ import { ConfirmDialog } from '../common/ConfirmDialog';

  export function SessionCard({ session }: { session: SessionInfo }) {
    const navigate = useNavigate();
    const removeSession = useSessionStore((s) => s.removeSession);
    const addSession = useSessionStore((s) => s.addSession);
    const addNotification = useNotificationStore((s) => s.addNotification);
+   const [confirmOpen, setConfirmOpen] = useState(false);

    const handleClose = async (e: React.MouseEvent) => {
      e.stopPropagation();
-     if (!window.confirm(`Delete session "${session.name}"?`)) return;
+     setConfirmOpen(true);
+   };
+
+   const handleConfirmDelete = async () => {
+     setConfirmOpen(false);
      removeSession(session.id);
      try {
        await api.deleteSession(session.id);
      } catch {
        addSession(session);
        addNotification('error', 'Failed to delete session');
      }
    };

    return (
-     <div ...>
+     <>
+       <ConfirmDialog
+         open={confirmOpen}
+         title="Delete session"
+         message={`Delete session "${session.name}"?`}
+         confirmLabel="Delete"
+         variant="danger"
+         onConfirm={handleConfirmDelete}
+         onCancel={() => setConfirmOpen(false)}
+       />
+       <div ...>
          {/* existing card content unchanged */}
+       </div>
+     </>
    );
  }
```

## Risks and Considerations

- **Focus management:** After the dialog closes, focus should return to the close button. The `ConfirmDialog` component should save and restore `document.activeElement` on open/close.
- **Event propagation:** The existing `e.stopPropagation()` in `handleClose` already prevents the card's click handler from navigating. The dialog renders via a portal-like fixed overlay so click events on the dialog won't bubble to the card.
- **Z-index:** Using `z-50` matches existing dialogs and will layer correctly above the session list and header (`z-10`).
- **No other usages:** `window.confirm()` is only used in this one location, so no other files need changes.
- **Minimal scope:** This is a focused change — one new component, one modified component. No store changes, no API changes, no routing changes.
