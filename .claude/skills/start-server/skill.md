---
name: start-server
description: Start the Clawd dev server (Express + Vite) after verifying ports are free
disable-model-invocation: true
allowed-tools: Bash(netstat *), Bash(taskkill *), Bash(cd * && npm run dev *), Bash(sleep *)
---

Start the Clawd dev server. Follow these steps exactly:

## 1. Pre-flight: check ports

Run `netstat -ano | grep -E ":(3050|3051) " | grep LISTEN` to check if the dev ports are already in use.

- If **both** ports are listening, report that the server is already running and exit.
- If **one** port is listening (stale state), kill the process on that port with `taskkill //F //PID <pid>`, wait 2 seconds, then confirm it's free.

**IMPORTANT:** Never kill processes on ports 3000-3001 — those are Docker containers.

## 2. Start the dev server

Run the following as a **background bash task**:

```
cd /c/Users/lmdud/OneDrive/Documents/Programming/Clawd && npm run dev 2>&1
```

## 3. Wait for startup

Wait 20 seconds (node --watch + Vite both need time to compile), then check the background task output for:
- `[server]` lines showing the server startup banner (ANTHROPIC_API_KEY status, listening URL)
- `[client]` lines showing Vite is ready

Also verify with `netstat -ano | grep -E ":(3050|3051) " | grep LISTEN` that both ports are listening.

## 4. Report status

Report:
- Whether the server is listening on port 3050
- Whether Vite is listening on port 3051
- Any errors visible in the output
- The background task ID (so the user can check logs later)

If the server isn't up after 20 seconds, wait another 15 seconds and check again before reporting failure. node --watch through concurrently can be slow to start on Windows.
