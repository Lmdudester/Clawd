---
name: self-test
description: Spin up a test Clawd instance and run E2E tests against it
user-invocable: true
---

# Self-Test Skill

Use this skill to spin up a separate test Clawd instance and run end-to-end tests against it using Playwright. This requires a session with Docker access.

## Prerequisites

- This session must have been created with **Docker access enabled**
- The `clawd:latest` and `clawd-session:latest` images must exist on the host
- `CLAUDE_CODE_OAUTH_TOKEN` must be set (forwarded automatically by the session agent)

## Instructions

### 1. Spin Up a Test Instance

Run the test launcher script:

```bash
bash /workspace/scripts/test-clawd.sh --branch <branch>
```

- Replace `<branch>` with the branch you want to test (e.g. `main`, `self-testing`)
- The script outputs the test instance URL (e.g. `http://test-clawd-1234567890:5000`) and container name
- Login credentials are `test` / `test`
- Wait for the script to confirm the instance is ready before proceeding

### 2. Run E2E Tests with Playwright MCP

Use the **Playwright MCP browser tools** (not raw Node.js scripts) for step-by-step browser testing:

1. Navigate to the test instance URL with `browser_navigate`
2. Use `browser_snapshot` to inspect page state (preferred over screenshots)
3. Interact with elements using `browser_click`, `browser_type`, `browser_fill_form`
4. Assert conditions by inspecting snapshots

**Important notes:**
- The test instance has no `project-repos.json`, so the New Session dialog shows raw URL + branch inputs instead of the repository dropdown. Fill the URL and branch fields manually.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers` is already set in the environment
- Playwright is installed globally — `import('playwright')` works if you need programmatic access

### 3. Clean Up

When testing is complete, always clean up the test instance:

```bash
bash /workspace/scripts/cleanup-test-clawd.sh <container-name>
```

This removes both the test master container and any session containers it spawned.

### 4. Report Results

Summarize:
- Which tests passed/failed
- Any errors encountered
- Screenshots or snapshots of failures

## Tips

- If the test instance takes too long to start, check its logs: `docker logs <container-name>`
- Test instances run on port 5000 within the Docker network — they're not exposed to the host
- Each test instance gets a unique name based on timestamp, so multiple can coexist
- The test instance uses `CLAWD_TEST_USER`/`CLAWD_TEST_PASSWORD` for simple auth (no OAuth needed for the test UI)
