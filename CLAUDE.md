# Clawd

Clawd is a self-hosted web UI for Claude Code sessions, running each session in an isolated Docker container with the Claude Agent SDK.

## Session Efficiency

You already have all the context you need from this file. Do not read source files, package.json, or directory listings to orient yourself — only read files that are directly relevant to your current task. If a skill gives you step-by-step instructions, start at step 1 immediately.

## Architecture

```
Browser (React SPA)  <-->  Master Server (Express + WS)  <-->  Session Containers (Agent SDK)
packages/client/           packages/server/                    packages/session-agent/
```

- **Master server** manages auth, session lifecycle, and proxies WebSocket messages between the browser and session containers.
- **Session containers** each run a single Claude Agent SDK `query()` loop with Playwright MCP pre-configured.
- **Shared types** live in `packages/shared/` and are used by all three packages.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `packages/server/` | Express server, WebSocket hub, Docker session orchestration |
| `packages/session-agent/` | SDK runner that executes inside each session container |
| `packages/client/` | React 19 + Tailwind 4 SPA, Zustand state management |
| `packages/shared/` | TypeScript types shared across packages |
| `session-skills/` | Skill definitions (markdown files) loaded into sessions |
| `scripts/` | Docker entrypoints and utility scripts |

## How Sessions Work

1. User creates a session via the UI, specifying a repo URL, branch, and permission mode.
2. Master server launches a Docker container from the `clawd-session` image.
3. The container clones the repo, starts the SDK runner (`sdk-runner.ts`), and connects back to the master via WebSocket.
4. All user messages and tool approvals flow through the master as a relay.

## How Plan Rendering Works

- The client detects Write/Edit tool calls targeting `.claude/plans/` via `isPlanFileWrite()`.
- These are rendered as a `PlanCard` component with collapsible preview and full-screen overlay.
- Plans use the standard Claude Code plan mode flow (EnterPlanMode -> write plan -> ExitPlanMode).

## Conventions

- npm workspaces (not yarn/pnpm)
- TypeScript throughout, `tsconfig.base.json` at root
- Session containers have Playwright MCP available by default
- Permission modes: `plan`, `normal`, `auto_edits`, `dangerous`
