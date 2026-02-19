---
name: e2e-test
description: Run the standard E2E testing script against a test Clawd instance
user-invocable: true
---

# E2E Test Skill

**IMPORTANT: Do NOT explore the codebase. Do NOT read source files, package.json, or project structure. Go directly to Step 1. A full E2E pass should complete under $1.00.**

Run the standard E2E testing suite against an isolated test Clawd instance using Playwright MCP.

**CRITICAL SAFETY RULES — you MUST follow all of these:**
- **NEVER `git push`** from any test session. Use only read-only prompts.
- **NEVER create a Clawd instance from within the test instance.** Sessions inside the test Clawd must NOT invoke `/self-test`, `/e2e-test`, or run `test-clawd.sh`.
- **Use only `https://github.com/octocat/Hello-World` branch `master`** for test sessions.
- **Always clean up** at the end, even if tests fail.

## Step 1: Spin Up a Test Instance

```bash
BRANCH=$(git -C /workspace branch --show-current 2>/dev/null || echo "main")
echo "Testing branch: $BRANCH"
bash /workspace/scripts/test-clawd.sh --branch "$BRANCH"
```

- Note the **test URL** (e.g. `http://test-clawd-1234567890:5000`) and **container name**
- Login credentials are `test` / `test`
- Wait for the script to confirm the instance is ready before proceeding

## Step 2: Read the E2E Testing Script

Read the testing script for the full list of test cases and expected results:

```
Read /workspace/docs/e2e-testing-script.md
```

This file contains **42 test cases across 13 suites**. Use it as your reference for every test.

## Step 3: Run Test Suites with Playwright MCP

Execute each suite from the testing script in order using the Playwright MCP browser tools.

**Workflow for each test case:**
1. Read the test case steps and expected results from the script
2. Use `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form` to execute steps
3. Use `browser_snapshot` to verify expected results after each action
4. Record PASS/FAIL for each test case

**Execution order:**
1. **AUTH** — Navigate to the test URL. Test login (correct, wrong, empty), logout, and session persistence
2. **LIST** — Verify empty state and usage card on the Session List page
3. **SESS** — Create sessions (basic, with Docker access, empty name). Verify cards and navigation
4. **CHAT** — Send messages, observe tool calls, streaming indicator, scroll button, interrupt
5. **APPR** — Test tool approval (approve, deny, stop turn) in `normal` mode. Test auto-approval in `dangerous` mode
6. **QUES** — Trigger and answer a question from Claude (option pill + custom answer)
7. **SETT** — Open session settings. Test rename, mode change, model change, notifications toggle
8. **PLAN** — Enter plan mode, write a plan, expand the plan card, approve/deny the plan
9. **SKILL** — Type `/` to trigger skill picker. Filter skills. Select `wrapup` (**NOT** `self-test` or `e2e-test`)
10. **MGMT** — Delete a session. Verify status transitions. Test back navigation
11. **GLOB** — Navigate to Settings page. Check auth display. Add/star/delete a project repo
12. **ERR** — Test invalid session URL, invalid route, message during startup, rapid messages, long messages
13. **UI** — Verify tool card colors, markdown rendering, status animations, toast notifications

**Tips:**
- The test instance has no `project-repos.json`, so the New Session dialog shows raw URL + branch inputs
- Use `dangerous` permission mode for sessions where you need tools to auto-execute (to avoid approval friction)
- Use `normal` mode specifically for Suite 5 (Tool Approval) tests
- For Suite 8 (Plan Mode), create a session in `auto_edits` mode so Claude can enter plan mode
- `browser_snapshot` is preferred over `browser_take_screenshot` for assertions

## Step 4: Clean Up

**Always run cleanup, even if tests failed:**

```bash
bash /workspace/scripts/cleanup-test-clawd.sh <container-name>
```

Verify no orphaned containers remain:
```bash
docker ps --filter "label=clawd.test-instance=true" --format "{{.Names}}"
```

## Step 5: Report Results

Summarize results using this format:

```
## E2E Test Results — {date}

### Summary
- Total: X/42 passed
- Failures: N
- Skipped: N

### Results by Suite
| Suite | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| AUTH  | X/5    |        |         |
| LIST  | X/2    |        |         |
| ...   | ...    |        |         |

### Failures
- **{TEST-ID}**: {description of failure + snapshot if available}

### Notes
- {any observations, regressions, or flaky behavior}
```
