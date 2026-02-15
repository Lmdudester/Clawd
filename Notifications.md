# Plan: Web Push Notifications for Clawd PWA

## Context

When a user adds Clawd to their iPhone home screen and switches away while Claude is working, they have no way to know when Claude finishes or asks a question. iOS aggressively suspends background processes, killing WebSocket connections. The only reliable way to reach a suspended PWA on iOS is **Web Push** (Push API + VAPID keys), which Apple added in iOS 16.4.

## Approach: Full Web Push

The server sends push notifications via the Web Push protocol when Claude finishes, needs tool approval, or asks a question. The service worker receives the push and shows a notification even if the app is suspended.

### What triggers a push notification

- **`result`** → "Claude has finished responding"
- **`approval_request`** → "Claude needs permission to use [toolName]"
- **`question`** → "Claude has a question for you"

Push is sent only when **no WebSocket clients are actively subscribed** to the session (i.e., the user isn't looking at it). This avoids duplicate alerts.

## New Dependency

- **`web-push`** (npm) — server-side library for sending Web Push notifications via VAPID

## Files to Create/Modify

### Server Side

#### 1. `packages/server/src/push/vapid.ts` (NEW)
- On first startup, generate VAPID keys and save to `vapid-keys.json` (same pattern as `credential-store.ts`)
- On subsequent startups, load existing keys
- Export the keys for use by push sender and the public key REST endpoint

#### 2. `packages/server/src/push/push-manager.ts` (NEW)
- Stores push subscriptions in memory (Map keyed by subscription endpoint)
- `subscribe(subscription)` — adds a subscription
- `unsubscribe(endpoint)` — removes a subscription
- `sendNotification(title, body, url?)` — sends to all stored subscriptions via `web-push`
- Handles expired/invalid subscriptions (auto-remove on 410 response)

#### 3. `packages/server/src/routes/push.ts` (NEW)
- `GET /api/push/vapid-public-key` — returns the VAPID public key (client needs this to subscribe)
- `POST /api/push/subscribe` — stores a push subscription
- `DELETE /api/push/subscribe` — removes a push subscription

#### 4. `packages/server/src/app.ts`
- Register the new `/api/push` routes

#### 5. `packages/server/src/ws/handler.ts`
- In the `result`, `approval_request`, and `question` event handlers, check if any WebSocket clients are subscribed to the session
- If no clients are subscribed (user is away), call `pushManager.sendNotification()`

#### 6. `packages/server/src/ws/connection-manager.ts`
- Add a `hasSubscribers(sessionId)` method to check if anyone is actively watching a session

### Client Side

#### 7. `packages/client/public/sw.js` (NEW)
- Service worker that handles:
  - `push` event — shows notification from push data
  - `notificationclick` event — focuses the app window or opens it

#### 8. `packages/client/src/main.tsx`
- Register the service worker on startup

#### 9. `packages/client/src/hooks/useNotifications.ts` (NEW)
- `permission` state tracking
- `requestPermission()` — requests notification permission, then subscribes to push:
  1. Calls `Notification.requestPermission()`
  2. Fetches VAPID public key from `/api/push/vapid-public-key`
  3. Calls `registration.pushManager.subscribe()` with the VAPID key
  4. POSTs the subscription to `/api/push/subscribe`
- `unsubscribe()` — unsubscribes and DELETEs from server

#### 10. `packages/client/src/components/chat/SettingsDialog.tsx`
- Add a "Notifications" section with an Enable button
- Shows current state: not asked / enabled / blocked
- Button calls `requestPermission()` (satisfies iOS user-gesture requirement)

#### 11. `packages/client/public/manifest.json`
- No changes needed (notifications don't require manifest changes)

## Push Flow

```
1. User taps "Enable Notifications" in Settings
2. Browser shows permission prompt → user grants
3. Client subscribes via pushManager.subscribe(VAPID key)
4. Client POSTs subscription to /api/push/subscribe
5. Server stores subscription in memory

Later:
6. Claude finishes / needs approval / asks question
7. SessionManager emits event → handler.ts receives it
8. handler.ts checks connectionManager.hasSubscribers(sessionId)
9. If no active WS subscribers → pushManager.sendNotification()
10. web-push sends to push service (Apple/Google)
11. iOS wakes service worker → sw.js shows notification
12. User taps notification → app opens/focuses
```

## Verification

1. `npm install web-push` in packages/server
2. Build both client and server
3. Open the app, go to Settings, enable notifications
4. Start a Claude session, close/minimize the app entirely
5. Verify push notification appears when Claude finishes
6. Verify tapping the notification opens/focuses the app
7. On iOS: add to home screen, repeat the above
