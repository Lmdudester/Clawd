# Clawd E2E Testing Script

> **Purpose:** Periodic manual regression testing of the Clawd web UI via the `/e2e-test` skill and Playwright MCP browser tools.
>
> **How to run:** From a Clawd session with Docker access, type `/e2e-test` to invoke the skill that automates this script.

---

## Safety Rules — Read Before Every Run

| # | Rule | Why |
|---|------|-----|
| S1 | **NEVER `git push` from a test session.** All test sessions must use read-only prompts or `plan` mode. If a session needs to execute tools, use `dangerous` mode only with safe prompts (e.g., `ls`, `cat`). | Prevents accidental pushes to real repositories. |
| S2 | **NEVER create a Clawd instance from within the test instance.** Sessions created inside the test Clawd must NOT invoke `/self-test`, `/e2e-test`, or run `test-clawd.sh`. | Prevents recursive Clawd spawning, resource exhaustion, and runaway containers. |
| S3 | **Use only public, read-only repos for test sessions.** Recommended: `https://github.com/octocat/Hello-World` branch `master`. | No risk of modifying real code. |
| S4 | **Always run cleanup** (`cleanup-test-clawd.sh`) when testing is finished, even after failures. | Prevents orphaned containers consuming resources. |
| S5 | **Do not send prompts that instruct the agent to push, deploy, or write to remote services.** | All test interactions should be local and observable. |

---

## Prerequisites & Setup

### Environment
- A running Clawd session **with Docker access enabled**
- The session must have access to the `/e2e-test` or `/self-test` skill

### Launch Test Instance

1. Run the test instance launcher:
   ```bash
   BRANCH=$(git -C /workspace branch --show-current 2>/dev/null || echo "main")
   bash /workspace/scripts/test-clawd.sh --branch "$BRANCH"
   ```
2. Note the output:
   - **Test URL**: e.g., `http://test-clawd-1234567890:5000`
   - **Container name**: e.g., `test-clawd-1234567890`
   - **Login**: `test` / `test`
3. Verify the instance is accessible:
   ```
   browser_navigate -> {Test URL}
   browser_snapshot -> should show login page
   ```

### Key Facts About the Test Instance
- No `project-repos.json` exists — the New Session dialog shows raw URL/branch inputs instead of a repo dropdown
- Sessions use the same `clawd-session:latest` image as production
- The test instance runs on port 5000 inside the Docker network

---

## Test Suites

---

### Suite 1: Authentication

#### AUTH-01 — Successful Login
**Preconditions:** Browser at test instance URL, not logged in.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` | Login page visible: username field, password field, login button, Clawd branding |
| 2 | `browser_fill_form` — username: `test`, password: `test` | Fields populated |
| 3 | Click the Login button | Redirects to Session List page (`/`). Header shows Clawd logo, Settings button, Logout button |

#### AUTH-02 — Failed Login (Wrong Password)
**Preconditions:** Browser at login page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_fill_form` — username: `test`, password: `wrong` | Fields populated |
| 2 | Click Login | Error message appears in the form (e.g., "Invalid credentials"). Does NOT redirect. Login form remains visible |

#### AUTH-03 — Failed Login (Empty Fields)
**Preconditions:** Browser at login page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Login without filling fields | Error message or validation prevents submission. Stays on login page |

#### AUTH-04 — Logout
**Preconditions:** Logged in, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the Logout button in the header | Redirects to login page. Subsequent navigation to `/` redirects back to login |

#### AUTH-05 — Session Persistence (Token in localStorage)
**Preconditions:** Logged in, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_navigate` to the test URL again (full page reload) | Remains logged in — Session List page loads without showing login |

---

### Suite 2: Session List & Empty State

#### LIST-01 — Empty Session List
**Preconditions:** Logged in, no sessions created yet.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` | Shows "No sessions yet" empty state message. FAB (+) button is visible. Settings and Logout buttons in header |

#### LIST-02 — Usage Card Display
**Preconditions:** Logged in, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` — look for the Usage Card | Usage card section is present (may show "Loading usage..." initially, then either usage data with progress bars OR an error state with retry button) |
| 2 | If usage data loaded: verify progress bars and reset times are displayed | Color-coded bars visible (green/yellow/red based on utilization) |
| 3 | If error state: click Refresh/Retry button | Retries the usage fetch |

**Note:** The test instance may not have valid API credentials, so an error state on the Usage Card is acceptable. The test verifies the card renders and handles errors gracefully.

---

### Suite 3: Session Creation

#### SESS-01 — Create Session (Basic)
**Preconditions:** Logged in, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the FAB (+) button | New Session dialog opens with fields: name, repo URL, branch |
| 2 | `browser_snapshot` | Dialog visible. Since no project-repos.json, shows raw URL + branch text inputs (no dropdown) |
| 3 | Fill: name = `Test Session 1`, repo URL = `https://github.com/octocat/Hello-World`, branch = `master` | Fields populated |
| 4 | Click Create | Dialog closes. Browser navigates to `/session/{id}`. Chat view loads with header showing "Test Session 1", repo badge "Hello-World", branch badge "master" |
| 5 | `browser_snapshot` | Status badge shows `starting` then transitions to `idle`. Empty message area with "Send a message to get started" |

#### SESS-02 — Create Session (with Docker Access)
**Preconditions:** Logged in, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click FAB (+) | Dialog opens |
| 2 | Fill: name = `Docker Session`, repo URL = `https://github.com/octocat/Hello-World`, branch = `master`, check Docker access checkbox | Fields populated, checkbox checked |
| 3 | Click Create | Session created and navigates to chat view |

> **SAFETY S2:** Do NOT use this Docker-enabled session to run `/self-test`, `/e2e-test`, or `test-clawd.sh`. This would create a recursive Clawd instance.

#### SESS-03 — Create Session (Empty Name Validation)
**Preconditions:** Logged in, New Session dialog open.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Leave name empty, fill repo URL and branch | Fields partially populated |
| 2 | Click Create | Either: error message shown in dialog, OR session created with a default/empty name (document actual behavior) |

#### SESS-04 — Session Card Display
**Preconditions:** At least one session created, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_navigate` to `/` (Session List) | Session card(s) visible |
| 2 | `browser_snapshot` | Each card shows: session name, status badge (colored dot + label), repo name, branch tag, creation time. Permission mode icon if non-default |

#### SESS-05 — Navigate to Session from List
**Preconditions:** Session card visible on Session List.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click on a session card | Navigates to `/session/{id}`. Chat view loads with correct session name in header |

---

### Suite 4: Chat Messaging

#### CHAT-01 — Send a Message and Receive Response
**Preconditions:** In chat view of an idle session (status = `idle`).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` | Message input textarea visible with placeholder "Message Claude..." and send button |
| 2 | Type `What files are in this repo?` in the textarea | Text appears in input |
| 3 | Click Send (or press Enter) | User message appears as a blue bubble on the right side. Streaming dots animation appears. Status transitions to `running` |
| 4 | Wait for response to complete | Assistant message appears as a gray bubble on the left. Tool call cards may appear (e.g., Bash `ls`, or Glob). Status returns to `idle` |
| 5 | `browser_snapshot` | Both user and assistant messages visible. Any tool calls show expandable cards with tool icons |

#### CHAT-02 — Message with Tool Calls (Read-Only)
**Preconditions:** In chat view of an idle session.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: `Read the README file` | User message appears |
| 2 | Wait for response | Tool call card(s) appear: Read tool (blue icon) showing file path. Tool result appears inline. Assistant summarizes the file content |
| 3 | Click on a tool call card header to expand it | Card expands showing full tool input (file path, content) |
| 4 | Click again to collapse | Card collapses back to summary |

#### CHAT-03 — Streaming Indicator
**Preconditions:** In chat view of an idle session.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send any message | Streaming text indicator (bouncing dots) appears while Claude is generating |
| 2 | Wait for completion | Dots disappear, replaced by full assistant response |

#### CHAT-04 — Scroll-to-Bottom Button
**Preconditions:** Chat view with enough messages to require scrolling.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Scroll up in the message list | A "scroll to bottom" button appears |
| 2 | Click the scroll-to-bottom button | View scrolls to the most recent message. Button disappears |

#### CHAT-05 — Interrupt Generation
**Preconditions:** In chat view, session is `running` (response in progress).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | While Claude is responding, look for a Stop button (red) | Stop button visible in the input area |
| 2 | Click Stop | Generation halts. Status returns to `idle`. Partial response may remain visible |

---

### Suite 5: Tool Approval Workflow

#### APPR-01 — Approve a Tool
**Preconditions:** Session in `normal` permission mode, idle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: `List the files using ls in the terminal` | Claude attempts a Bash tool call |
| 2 | `browser_snapshot` | Approval banner appears: "Allow Bash?" with tool preview (the `ls` command), YES (green) and NO (red) buttons. Status = `awaiting_approval` |
| 3 | Click YES | Tool executes. Result appears. Claude continues its response. Status -> `running` -> `idle` |

#### APPR-02 — Deny a Tool
**Preconditions:** Session in `normal` permission mode, idle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: `Run ls -la in the terminal` | Approval banner appears |
| 2 | Click NO | Tool is denied. Claude receives denial message and may adjust its approach. Status -> `running` -> `idle` |

#### APPR-03 — Stop Entire Turn from Approval
**Preconditions:** Approval banner visible.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Look for "Stop entire turn" button below the YES/NO buttons | Button visible |
| 2 | Click "Stop entire turn" | Turn is interrupted. Status returns to `idle` |

#### APPR-04 — Dangerous Mode Auto-Approval
**Preconditions:** Session in `dangerous` permission mode.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: `Run ls in the terminal` | Claude executes the Bash tool **without** showing an approval banner. Tool result appears directly |

> **SAFETY S1/S5:** Only use safe, read-only commands in dangerous mode. Do NOT send prompts that write, push, or modify remote resources.

---

### Suite 6: Question/Survey Workflow

#### QUES-01 — Answer a Question
**Preconditions:** Session idle. Need to trigger a question from Claude.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send a prompt that triggers AskUserQuestion, e.g.: `I want to add a new feature. Ask me what kind of feature I'd like before doing anything.` | Claude sends a question |
| 2 | `browser_snapshot` | Question panel appears: question text, option pills/buttons, custom input field, Submit button. Status = `awaiting_answer` |
| 3 | Click one of the option pills | Option becomes selected (highlighted) |
| 4 | Click Submit Answer | Answer sent. Claude continues based on selection. Status -> `running` -> `idle` |

#### QUES-02 — Custom Answer
**Preconditions:** Question panel visible.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Instead of selecting a pill, type a custom answer in the text input | Custom text appears in input |
| 2 | Click Submit Answer | Custom answer sent. Claude processes it |

---

### Suite 7: Session Settings

#### SETT-01 — Open and Close Settings Dialog
**Preconditions:** In chat view.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the Settings gear icon in the chat header | Settings dialog opens. Shows: session name field, model dropdown, permission mode toggle (4 options), notifications toggle |
| 2 | `browser_snapshot` | All settings fields visible with current values |
| 3 | Click the Close button | Dialog closes. Chat view returns to normal |

#### SETT-02 — Rename Session
**Preconditions:** Settings dialog open.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Clear the session name field and type `Renamed Session` | Name field updates. Live preview: the session name in the chat header updates in real-time |
| 2 | Close the dialog | Name persists. Navigate to Session List — card shows "Renamed Session" |

#### SETT-03 — Change Permission Mode
**Preconditions:** Settings dialog open, session in `normal` mode.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the "Plan" mode button in the permission toggle | Mode switches to Plan. A permission mode banner may appear below the header |
| 2 | Close dialog and send a message | Session operates in plan mode (write tools blocked, only plan files allowed) |
| 3 | Re-open settings and switch back to "Normal" | Mode returns to normal |

#### SETT-04 — Change Model
**Preconditions:** Settings dialog open, models loaded.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` — check model dropdown | Dropdown shows current model. May show "Loading models..." initially |
| 2 | Select a different model from the dropdown | Model changes. A system message may appear in chat: "Model changed to {model}" |

#### SETT-05 — Toggle Notifications
**Preconditions:** Settings dialog open.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the Notifications toggle | Switches between Enabled/Disabled |
| 2 | `browser_snapshot` | Toggle reflects new state |

---

### Suite 8: Plan Mode

#### PLAN-01 — Enter Plan Mode and Write a Plan
**Preconditions:** Create a new session with `auto_edits` or `normal` mode.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: `Enter plan mode and write a short 3-bullet plan for adding a README file` | Claude calls EnterPlanMode. Permission mode switches to `plan`. Then Claude writes a plan file to `.claude/plans/` |
| 2 | `browser_snapshot` | Plan card appears in the message list: shows file name, "Plan" label, collapsed content preview with markdown |
| 3 | Click the plan card expand button | Full-screen plan overlay opens: back button, file name, scrollable markdown content |
| 4 | `browser_snapshot` in overlay | Full plan content visible, properly rendered as markdown |
| 5 | Click back/close on overlay | Overlay dismisses. Chat view returns |

#### PLAN-02 — Approve a Plan (ExitPlanMode)
**Preconditions:** Plan has been written (PLAN-01 completed). Claude calls ExitPlanMode.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | When Claude calls ExitPlanMode, `browser_snapshot` | Approval banner appears: "Approve plan as-is?" with YES/NO buttons |
| 2 | Click YES | Plan approved. Permission mode switches back to `normal`. Claude proceeds to implement |

#### PLAN-03 — Deny a Plan
**Preconditions:** ExitPlanMode approval banner visible.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click NO | Plan denied. Session stays in plan mode. Claude may ask for feedback or revise |

---

### Suite 9: Skill Invocation

#### SKILL-01 — Skill Picker Appears on Slash
**Preconditions:** In chat view, session idle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the message input textarea | Input focused |
| 2 | Type `/` | Skill picker dropdown appears above the textarea showing available skills (e.g., "wrapup", "self-test") |
| 3 | `browser_snapshot` | Dropdown visible with skill names and descriptions, lightning bolt icons |

#### SKILL-02 — Select a Skill
**Preconditions:** Skill picker visible.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click on "wrapup" in the skill picker | Skill command is sent as a message (e.g., `/wrapup`). Skill picker closes |
| 2 | Wait for Claude's response | Claude begins executing the wrapup skill steps (review changes, etc.) |

> **SAFETY S2:** Do NOT select the `self-test` or `e2e-test` skill from within the test instance. This would create a recursive Clawd instance.

#### SKILL-03 — Skill Picker Filtering
**Preconditions:** Skill picker visible.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Type `/wrap` | Skill picker filters to show only matching skills (e.g., "wrapup") |
| 2 | Type `/nonexistent` | Skill picker shows no matching results or closes |

---

### Suite 10: Session Management

#### MGMT-01 — Delete a Session
**Preconditions:** At least one session exists, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` | Session card(s) visible with delete button |
| 2 | Click the delete button on a session card | Session is removed from the list. If it was the only session, empty state appears |

#### MGMT-02 — Session Status Transitions
**Preconditions:** A newly created session.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Immediately after creation, `browser_snapshot` | Status badge shows `starting` (with animated pulse) |
| 2 | Wait for container to be ready | Status transitions to `idle` |
| 3 | Send a message | Status transitions to `running` (animated pulse) |
| 4 | When response completes | Status returns to `idle` |

#### MGMT-03 — Navigate Back from Chat to Session List
**Preconditions:** In chat view.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the back arrow button in the chat header | Navigates to `/` (Session List page). Session card is visible |

---

### Suite 11: Global Settings

#### GLOB-01 — Navigate to Settings Page
**Preconditions:** Logged in, on Session List page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the Settings button in the header | Navigates to `/settings`. Settings page loads with Auth Settings and Project Repos sections |

#### GLOB-02 — Auth Settings Display
**Preconditions:** On Settings page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` | Auth Settings section visible: shows auth method (OAuth/None), token status (Valid/Expired/None), credential path if set |
| 2 | Click "Discover Claude CLI Credentials" | Either: lists discovered credential files, or shows none found |

#### GLOB-03 — Project Repos Management
**Preconditions:** On Settings page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` | Project Repos section visible. May show "No project repos configured" |
| 2 | Fill the Add Repo form: label = `Test Repo`, URL = `https://github.com/octocat/Hello-World`, branch = `master` | Fields populated |
| 3 | Click Add | Repo appears in the list with star icon and delete button |
| 4 | Click the star icon on the repo | Star fills indicating it's the default |
| 5 | Click the delete button on the repo | Repo is removed from the list |

#### GLOB-04 — Navigate Back from Settings
**Preconditions:** On Settings page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the back button | Navigates to `/` (Session List) |

---

### Suite 12: Error Handling & Edge Cases

#### ERR-01 — Session Not Found
**Preconditions:** Logged in.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_navigate` to `{Test URL}/session/nonexistent-id` | Error state displayed: "Session not found" or similar message with a back button |
| 2 | Click back button | Returns to Session List |

#### ERR-02 — Invalid Route
**Preconditions:** Logged in.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_navigate` to `{Test URL}/invalid/route` | Redirects to `/` (Session List) |

#### ERR-03 — Send Message While Session Starting
**Preconditions:** Freshly created session still in `starting` status.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Attempt to type and send a message | Either: input is disabled until session is ready, OR message is queued and sent when ready |

#### ERR-04 — Rapid Multiple Messages
**Preconditions:** Session idle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send a message, then immediately try to send another before the first response completes | Second message either queues or the input is disabled during processing. No UI crash or duplicate messages |

#### ERR-05 — Long Message Content
**Preconditions:** Session idle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send a very long message (500+ characters) | Message sends successfully. User bubble displays the full text (may require scrolling). No UI overflow issues |

---

### Suite 13: UI & Visual Verification

#### UI-01 — Tool Call Card Colors and Icons
**Preconditions:** Chat with visible tool calls.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` after a response with tool calls | Tool cards show correct icons and color coding: Bash (emerald), Read (blue), Edit (amber), Write (violet), Glob (cyan), etc. |

#### UI-02 — Markdown Rendering in Assistant Messages
**Preconditions:** Session idle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: `Show me a markdown example with a heading, a bullet list, and a code block` | Assistant response renders markdown: heading styled, bullet list with indentation, code block with syntax highlighting and copy button |
| 2 | Click the copy button on the code block | Code copied to clipboard (verify button visual feedback) |

#### UI-03 — Status Badge Animations
**Preconditions:** Session in various states.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Observe badge during `starting` state | Animated pulse on the status dot |
| 2 | Observe badge during `running` state | Animated pulse on the status dot |
| 3 | Observe badge during `idle` state | Static dot, no animation |

#### UI-04 — Toast Notifications
**Preconditions:** Trigger an action that produces a toast (e.g., an error).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `browser_snapshot` when a toast appears | Toast visible in top-right corner with appropriate color (red for error, green for success) and dismiss button |
| 2 | Click dismiss button | Toast disappears |

---

## Teardown

**Always run these steps at the end of every testing session, even if tests failed.**

1. Navigate to Session List in the test instance and delete all sessions
2. Close the Playwright browser:
   ```
   browser_close
   ```
3. Clean up the test instance container:
   ```bash
   bash /workspace/scripts/cleanup-test-clawd.sh <container-name>
   ```
4. Verify cleanup:
   ```bash
   docker ps --filter "label=clawd.test-instance=true" --format "{{.Names}}"
   ```
   Expected: no containers listed from this test run

---

## Test Run Checklist

| Suite | ID Range | Pass | Fail | Skip | Notes |
|-------|----------|------|------|------|-------|
| Authentication | AUTH-01 to AUTH-05 | | | | |
| Session List | LIST-01 to LIST-02 | | | | |
| Session Creation | SESS-01 to SESS-05 | | | | |
| Chat Messaging | CHAT-01 to CHAT-05 | | | | |
| Tool Approval | APPR-01 to APPR-04 | | | | |
| Question/Survey | QUES-01 to QUES-02 | | | | |
| Session Settings | SETT-01 to SETT-05 | | | | |
| Plan Mode | PLAN-01 to PLAN-03 | | | | |
| Skill Invocation | SKILL-01 to SKILL-03 | | | | |
| Session Management | MGMT-01 to MGMT-03 | | | | |
| Global Settings | GLOB-01 to GLOB-04 | | | | |
| Error Handling | ERR-01 to ERR-05 | | | | |
| UI/Visual | UI-01 to UI-04 | | | | |

**Total: 42 test cases across 13 suites**
