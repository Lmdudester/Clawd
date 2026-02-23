# Fix: WebSocket Upgrade Auth & CORS Configuration

**Branch:** `fix/websocket-and-cors-security`
**Issues:** #72 (WebSocket upgrade has no authentication check), #71 (No CORS configuration)

---

## Problem Analysis

### #72 — WebSocket upgrade has no authentication

The `/ws` endpoint in `packages/server/src/index.ts:100-104` accepts **any** HTTP upgrade request without authentication. The current flow is:

1. Client opens `new WebSocket(url)` — upgrade completes unconditionally.
2. After the WebSocket is open, the client sends an `{ type: 'auth', token }` message.
3. If the client doesn't authenticate within 10 seconds, the server closes the connection.

This means unauthenticated clients can hold open WebSocket connections for up to 10 seconds, and the TCP/TLS handshake + upgrade have already completed before any auth check. An attacker can repeatedly open connections to consume server resources.

### #71 — No CORS configuration

There is zero CORS configuration anywhere in the codebase (confirmed by grep). The Express app in `packages/server/src/app.ts` uses no CORS middleware. This means:

- Browser-based requests from any origin can hit all `/api/*` endpoints.
- While browsers enforce same-origin for XHR/fetch, the server doesn't validate the `Origin` header, so a malicious page could make credentialed requests if the user has a valid JWT stored.

---

## Implementation Plan

### 1. WebSocket upgrade authentication (`packages/server/src/index.ts`)

**Approach:** Validate the JWT token during the HTTP upgrade request, *before* calling `wss.handleUpgrade()`. The client will pass the token as a query parameter (`?token=<jwt>`) on the WebSocket URL. If the token is invalid or missing, reject the upgrade with a 401 response at the TCP level — no WebSocket connection is ever established.

**Changes to `packages/server/src/index.ts`** (lines 99-118):

```
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname === '/ws') {
    // Validate JWT before upgrading
    const token = url.searchParams.get('token');
    if (!token || !verifyToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
  } else if (pathname === '/internal/session') {
    // (existing internal secret check — unchanged)
  } else {
    socket.destroy();
  }
});
```

- Import `verifyToken` from `./auth/middleware.js`.
- The `verifyToken` function already exists and returns `{ username } | null`.

**Changes to client `packages/client/src/hooks/useWebSocket.ts`** (line 45):

Pass the token as a query parameter on the WebSocket URL:

```ts
const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
```

The existing post-connection `auth` message flow (line 52) should be **kept as-is** — it registers the user in the `ConnectionManager`. The upgrade-level check is an additional gate, not a replacement.

**Why query parameter instead of headers:**
The browser `WebSocket` API does not support setting custom headers (like `Authorization`). The only options are:
- Query parameter (standard practice, used by Socket.IO, Supabase, etc.)
- Subprotocol hack (non-standard, fragile)

Query parameters in WebSocket URLs are acceptable because: the URL is not logged by default in Express, the token is short-lived (7 days), and the connection is over TLS in production.

### 2. CORS configuration (`packages/server/src/app.ts`)

**Approach:** Add the `cors` npm package and configure it to restrict cross-origin access.

**Install dependency:**
```
npm install cors && npm install -D @types/cors
```

**Changes to `packages/server/src/app.ts`:**

Add CORS middleware before API routes:

```ts
import cors from 'cors';

// Inside createApp():
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : undefined;  // undefined = no CORS headers (same-origin only)

app.use(cors({
  origin: allowedOrigins ?? false,
  credentials: true,
}));
```

When `CORS_ORIGINS` is not set, `origin: false` means no `Access-Control-Allow-Origin` header is sent — browsers will block all cross-origin requests (same-origin-only behavior, which is the safe default for a self-hosted app).

When `CORS_ORIGINS` is set (e.g., `CORS_ORIGINS=https://my-domain.com,https://other.com`), those origins are explicitly allowed.

**Update `.env.example`:**

Add:
```
# Optional: Comma-separated list of allowed CORS origins.
# If not set, only same-origin requests are allowed (recommended for most deployments).
# CORS_ORIGINS=https://my-domain.com
```

**Update `packages/server/src/config.ts`:**

Add a `corsOrigins` config field:
```ts
corsOrigins: process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : null,
```

Then reference `config.corsOrigins` in `app.ts` instead of reading `process.env` directly, keeping the pattern consistent with the rest of the config.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/server/src/index.ts` | Add `verifyToken` import; add JWT validation in the `/ws` upgrade branch before `handleUpgrade` |
| `packages/server/src/app.ts` | Add `cors` import and middleware with configurable origin list |
| `packages/server/src/config.ts` | Add `corsOrigins` config field parsed from `CORS_ORIGINS` env var |
| `packages/client/src/hooks/useWebSocket.ts` | Append `?token=` query parameter to WebSocket URL |
| `.env.example` | Add `CORS_ORIGINS` documentation |
| `packages/server/package.json` | Add `cors` + `@types/cors` dependencies (via `npm install`) |

---

## Risks and Edge Cases

1. **Token in URL logging:** WebSocket URLs with tokens could appear in proxy logs or browser history. Mitigated by: tokens are already short-lived (7d), and the URL path `/ws?token=...` is not a navigable page. If a reverse proxy logs query strings, operators should configure it to redact them — this is standard practice for WebSocket auth.

2. **Token refresh during long WS sessions:** If a token expires while a WebSocket is open, the connection remains valid because the token was only checked at upgrade time. This is acceptable — the existing 10-second auth timeout + in-band `auth` message provides the session-level binding. A future improvement could add periodic re-validation.

3. **CORS and WebSocket:** CORS does not apply to WebSocket connections (browsers don't enforce same-origin for `new WebSocket()`). The upgrade-level JWT check in #72 is the correct mitigation for WebSocket cross-origin access.

4. **Breaking change for API consumers:** If any external tools call the REST API cross-origin without setting `CORS_ORIGINS`, they will be blocked. This is intentional — the default should be secure. Document in `.env.example`.

5. **Double auth on WebSocket:** After this change, the WebSocket has two auth checks: upgrade-level (token in URL) and message-level (auth message). Both are needed — the upgrade check prevents unauthenticated connections from being established, and the message-level auth binds the connection to a username in the ConnectionManager.

---

## What This Does NOT Change

- The internal WebSocket (`/internal/session`) already validates a shared secret at upgrade time — no changes needed.
- The existing `authMiddleware` on REST routes is already correctly applied — no changes needed.
- The `auth` message flow inside the WebSocket handler stays as-is.
