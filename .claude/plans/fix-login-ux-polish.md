# Fix: Login UX Polish

**Branch:** `fix/login-ux-polish`

## Issues

### #169 — Login error message persists after clearing fields or typing new input

**Root cause:** In `LoginPage.tsx`, the `error` state is only cleared inside `handleSubmit` (line 14: `setError('')`). The `onChange` handlers for the username and password inputs only update their respective values — they never dismiss the error. Once "Invalid credentials" is shown, it stays visible until the user submits the form again.

**Fix:** Clear the `error` state whenever the user modifies either input field. This is the standard UX pattern — stale validation messages should be dismissed as soon as the user begins correcting their input.

### #172 — Duplicate console errors on failed login attempt

**Root cause:** The generic `request()` function in `api.ts` has a 401 handler (lines 38-42) that unconditionally calls `useAuthStore.getState().logout()` and throws an error for *every* 401 response. This handler is designed for authenticated API calls — when a session token expires, it logs the user out and redirects to login.

However, the `/auth/login` endpoint also returns 401 for invalid credentials. When a login attempt fails:

1. `request()` catches the 401, calls `logout()` (which clears localStorage and updates Zustand state), and throws an error.
2. The `logout()` call triggers a Zustand state update (`isAuthenticated: false`). Since the user is already on the login page (not authenticated), this is a no-op in terms of routing, but it still triggers a React re-render cycle.
3. Under React 18+ StrictMode (confirmed in `main.tsx`), effects and state updates can cause components to mount/unmount/remount in development. The combination of the Zustand state change mid-request and StrictMode's double-invocation behavior causes the form submission handler or a re-render to fire the login request a second time.

The result: two identical `POST /auth/login` 401 responses appear in the Network/Console tabs.

**Fix:** Skip the `logout()` side-effect for login requests. The login endpoint is the one place where a 401 is an *expected* application response (wrong password), not a session expiry. The error should be caught and displayed, but `logout()` should not be called since the user isn't logged in.

---

## Files to Change

### 1. `packages/client/src/components/auth/LoginPage.tsx`

**Changes for #169:**

- Add a `clearError` helper or inline `setError('')` calls in both input `onChange` handlers, so the error banner is dismissed as soon as the user types.

Specifically, change the `onChange` handlers from:

```tsx
onChange={(e) => setUsername(e.target.value)}
```

to:

```tsx
onChange={(e) => { setUsername(e.target.value); if (error) setError(''); }}
```

And identically for the password field:

```tsx
onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
```

The `if (error)` guard avoids an unnecessary state update on every keystroke when there's no error displayed.

### 2. `packages/client/src/lib/api.ts`

**Changes for #172:**

- Modify the `request()` function's 401 handler to skip calling `logout()` when the request is to the login endpoint (`/auth/login`). This prevents the spurious Zustand state update that triggers the duplicate request under StrictMode.

Specifically, change the 401 block from:

```ts
if (res.status === 401) {
  const body = await res.json().catch(() => ({ error: 'Unauthorized' }));
  useAuthStore.getState().logout();
  throw new Error(body.error || 'Unauthorized');
}
```

to:

```ts
if (res.status === 401) {
  const body = await res.json().catch(() => ({ error: 'Unauthorized' }));
  if (path !== '/auth/login') {
    useAuthStore.getState().logout();
  }
  throw new Error(body.error || 'Unauthorized');
}
```

This keeps the automatic logout behavior for all other API calls (token expiry) while letting the login form handle its own 401 errors gracefully through the existing try/catch in `handleSubmit`.

---

## Implementation Order

1. Fix `api.ts` first (#172) — this is the lower-level change and eliminates the duplicate request.
2. Fix `LoginPage.tsx` (#169) — add error-clearing to input handlers.
3. Manual verification: attempt login with bad credentials, confirm single 401 in console and error clears on typing.

## Risks and Considerations

- **Low risk.** Both changes are small and isolated to the login flow. No other components or API calls are affected.
- The `path !== '/auth/login'` check is a string comparison against a hardcoded path. This is acceptable since the login endpoint path is already hardcoded in the `api.login()` method on line 55 of the same file. If the path ever changes, both would need updating together — they're in the same file.
- The error-clearing UX is a widely expected pattern. No risk of confusing users.
- No issues to skip — both are feasible and straightforward.

## Issues to Skip

None. Both issues are feasible with minimal, well-scoped changes.
