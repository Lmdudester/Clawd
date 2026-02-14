---
name: restart-server
description: Restart the Clawd dev server (stop then start)
disable-model-invocation: true
---

Restart the Clawd dev server by invoking the stop and start skills in sequence:

1. First, invoke `/stop-server` to stop the running server and verify ports are free.
2. Then, invoke `/start-server` to start a fresh server instance and verify it's running.
