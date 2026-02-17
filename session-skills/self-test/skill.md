---
name: self-test
description: Spin up a test Clawd instance and run E2E tests against it
user-invocable: true
---

# Self-Test Skill

**IMPORTANT: Do NOT explore the codebase. Do NOT read source files, package.json, or project structure. Go directly to Step 1. Simple E2E tests should complete under $0.50.**

Spin up a separate test Clawd instance and run E2E tests against it using Playwright.

**CRITICAL: Do NOT navigate to `clawd:4000` or any parent instance URL. You must spin up your OWN test instance using the script below and test against THAT.**

## Step 1: Spin Up a Test Instance

Detect the current branch and launch the test instance:

```bash
BRANCH=$(git -C /workspace branch --show-current 2>/dev/null || echo "main")
echo "Testing branch: $BRANCH"
bash /workspace/scripts/test-clawd.sh --branch "$BRANCH"
```

- The script outputs the test instance URL (e.g. `http://test-clawd-1234567890:5000`) and container name
- Login credentials are `test` / `test`
- Wait for the script to confirm the instance is ready before proceeding

## Step 2: Run E2E Tests with Playwright MCP

Use the **Playwright MCP browser tools** to test the instance from Step 1:

1. Navigate to the test instance URL (from Step 1 output) with `browser_navigate`
2. Log in with `test` / `test`
3. Use `browser_snapshot` to inspect page state (preferred over screenshots)
4. Interact with elements using `browser_click`, `browser_type`, `browser_fill_form`
5. Assert conditions by inspecting snapshots

**Tips:**
- The test instance has no `project-repos.json`, so the New Session dialog shows raw URL + branch inputs instead of the repository dropdown
- `PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers` is already set
- Test sessions can use `dangerous` permission mode to avoid approval dialog friction during E2E tests

## Step 3: Clean Up

When testing is complete, always clean up:

```bash
bash /workspace/scripts/cleanup-test-clawd.sh <container-name>
```

## Step 4: Report Results

Summarize which tests passed/failed, any errors encountered, and snapshots of failures.

## Test Recipes

### Recipe: Verify Plan Markdown View
1. Create a new session (any repo, `auto_edits` mode)
2. Send: "Enter plan mode and write a short 3-bullet plan for adding a README"
3. Wait for the plan card to appear in the chat
4. Click the plan card to open the full-screen overlay
5. Assert: overlay is visible, contains markdown content, has a close button
6. Close the overlay and assert it's dismissed

### Recipe: Verify Session Creation
1. Click "New Session" from the session list
2. Fill in a repo URL (e.g. `https://github.com/octocat/Hello-World`), branch `master`, permission mode `normal`
3. Submit the form
4. Assert: session appears in the list, status transitions to "running"
5. Send a simple message like "What files are in this repo?" and verify a response appears

### Recipe: Verify Skill Invocation
1. Create a new session (any repo, `auto_edits` mode)
2. Type `/` in the input to trigger the skill picker
3. Assert: skill options appear (e.g. "wrapup")
4. Select a skill and verify it loads into the input

## Troubleshooting

- If the test instance takes too long to start, check logs: `docker logs <container-name>`
- Test instances run on port 5000 within the Docker network — not exposed to the host
- Each test instance gets a unique name based on timestamp, so multiple can coexist
