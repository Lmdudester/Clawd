# Clawd

A web-based remote interface for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's CLI coding assistant. Run Claude Code inside a Docker container and interact with it from any browser on your local network — including mobile devices.

## Features

- **Multi-session management** — Create, view, and delete independent Claude Code sessions, each with its own working directory and message history
- **Real-time streaming** — Messages stream token-by-token over WebSocket with a live typing indicator
- **Tool approval workflow** — Approve or deny each tool call (Bash, Edit, Read, etc.) before Claude executes it
- **Permission modes** — Per-session permission control:
  - *Normal* — Prompt for each tool use
  - *Auto Accept* — Automatically approve all tool calls
  - *Plan* — Deny all tool calls, forcing Claude to describe rather than execute
- **Model switching** — Switch between available Claude models mid-session
- **API usage monitoring** — Real-time Anthropic API rate limit display with color-coded progress bars
- **Dual authentication** — Use an Anthropic API key or OAuth credentials from an existing Claude CLI installation (Claude Max)
- **Project folder bookmarks** — Save frequently-used project directories for quick session creation
- **Windows path translation** — Seamless translation between Windows host paths and Docker container paths
- **Push notifications** — Optional [ntfy.sh](https://ntfy.sh) integration sends mobile/desktop alerts when a session needs approval, asks a question, or finishes a task (only fires when no one is actively viewing the session)
- **PWA support** — Install as a Progressive Web App for an app-like experience on mobile
- **Auto-update deployment** — Optional Docker configuration that pulls the latest code on every container start

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, React Router |
| Backend | Node.js 22, Express 5, WebSocket (ws), JWT authentication |
| Core | [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| Infrastructure | Docker, Docker Compose, npm workspaces |

## Project Structure

```
clawd/
├── packages/
│   ├── shared/          # Shared TypeScript types (client + server)
│   ├── server/          # Express + WebSocket backend
│   │   └── src/
│   │       ├── auth/        # JWT authentication middleware
│   │       ├── routes/      # REST API endpoints
│   │       ├── sessions/    # Claude Code session management
│   │       ├── settings/    # Credential & folder persistence
│   │       └── ws/          # WebSocket handler & routing
│   └── client/          # React SPA frontend
│       └── src/
│           ├── components/  # UI components (chat, sessions, settings)
│           ├── hooks/       # Custom React hooks
│           ├── stores/      # Zustand state management
│           └── lib/         # API client utilities
├── scripts/             # Docker entrypoint scripts
├── Dockerfile           # Standard Docker build
├── Dockerfile.autoupdate # Auto-updating Docker build
└── docker-compose.yml   # Docker Compose configuration
```

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- One of the following for Claude access:
  - An [Anthropic API key](https://console.anthropic.com/)
  - An existing [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installation with OAuth credentials (Claude Max subscription)

### Quick Start

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Lmdudester/Clawd.git
   cd Clawd
   ```

2. **Create a credentials file** for app login:

   ```bash
   cat > credentials.json << 'EOF'
   [
     { "username": "your-username", "password": "your-password" }
   ]
   EOF
   ```

3. **Configure environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env and add your Anthropic API key (optional if using OAuth)
   ```

4. **Update `docker-compose.yml`** volume mounts to match your host filesystem:

   ```yaml
   volumes:
     - /c:/host/c                              # Mount your host drive
     - ./credentials.json:/app/credentials.json:ro  # Mount credentials
   ```

5. **Build and start:**

   ```bash
   docker compose up -d --build
   ```

6. **Open** `http://localhost:3000` in your browser and log in with the credentials you configured.

> **Note:** The standard Docker entrypoint runs `git pull`, `npm install`, and `npm run build` on every container start, so it will automatically pick up new commits if the repository is mounted. To disable this behavior, use the auto-update Dockerfile instead (which clones fresh on each start) or remove the pull/build steps from `scripts/entrypoint.sh`.

### Using OAuth (Claude Max)

If you have a Claude Max subscription with the Claude CLI installed:

1. Log in to the app and navigate to **Settings**
2. Use the **Auth Settings** section to locate your Claude CLI credentials (typically in `~/.claude/.credentials.json` on the host)
3. The app will use your OAuth tokens for Claude access — no API key needed

### Enabling Git Push

By default, Claude sessions inside Docker cannot `git push` because the container has no git credentials. To enable push access:

1. **Create a GitHub Personal Access Token (PAT):**
   - Go to [GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta)
   - Create a token with **Contents: Read and write** permission on the repos you want Claude to push to

2. **Add environment variables** to your `.env` file or `docker-compose.yml`:

   ```bash
   GIT_USER_NAME=Your Name
   GIT_USER_EMAIL=you@example.com
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

3. **Uncomment the git variables** in `docker-compose.yml` under the `environment` section, or add them to `.env`.

4. **Rebuild and restart:**

   ```bash
   docker compose up -d --build
   ```

The entrypoint script configures `git config --global` identity and credential storage at startup. All Claude sessions inherit these settings automatically.

> **Non-GitHub hosts:** Use `GIT_CREDENTIALS_URL` instead of `GITHUB_TOKEN` with the format `https://username:token@your-git-host.com`.

### Push Notifications (ntfy.sh)

Clawd can send push notifications to your phone or desktop when a session needs your attention (tool approval, question, or task completion) and no one is actively viewing the session.

1. **Install the [ntfy app](https://ntfy.sh)** on your phone or subscribe to a topic in the web UI
2. **Choose a unique topic name** (e.g., `clawd-myname`) and subscribe to it in the app
3. **Add environment variables** to your `.env` file:

   ```bash
   NTFY_TOPIC=clawd-myname
   # NTFY_SERVER=https://ntfy.sh   # Only needed if self-hosting
   ```

4. **Enable notifications per session** — Open a session's settings in the Clawd UI and toggle notifications on. Notifications are disabled by default for each session.

### Auto-Update Deployment

For a deployment that automatically pulls the latest code on every container restart:

1. **Copy the example compose file:**

   ```bash
   cp docker-compose.autoupdate.example.yml docker-compose.autoupdate.yml
   ```

2. **Edit** `docker-compose.autoupdate.yml` with your volume mounts and environment variables.

3. **Start with the auto-update compose file:**

   ```bash
   docker compose -f docker-compose.autoupdate.yml up -d --build
   ```

## Development

### Local Development Setup

Requires [Node.js 22+](https://nodejs.org/) and npm.

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create configuration files:**

   ```bash
   cp .env.example .env
   # Add your ANTHROPIC_API_KEY to .env

   # Create credentials.json with your login credentials
   echo '[{"username": "dev", "password": "dev"}]' > credentials.json
   ```

3. **Start the dev servers:**

   ```bash
   npm run dev
   ```

   This runs both the backend (port 3050) and Vite dev server (port 3051) concurrently. Open `http://localhost:3051` for development with hot reload.

### Build

```bash
npm run build   # Build shared types, client, and server
npm start       # Start the production server
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Anthropic API key (optional if using OAuth) |
| `CLAWD_HOST` | `localhost` | Server bind address (`0.0.0.0` for Docker/LAN access) |
| `CLAWD_PORT` | `3050` | Server port |
| `HOST_DRIVE_PREFIX` | — | Container path prefix for host drive mount (e.g., `/host/c`) |
| `JWT_SECRET` | Auto-generated | JWT signing secret (tokens invalidate on restart if not set) |
| `CREDENTIALS_PATH` | `./credentials.json` | Path to the login credentials file |
| `PROJECT_FOLDERS_PATH` | `./project-folders.json` | Path to the project folders config file |

### Git Push (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_USER_NAME` | — | Git commit author name |
| `GIT_USER_EMAIL` | `<name>@users.noreply.github.com` | Git commit author email |
| `GITHUB_TOKEN` | — | GitHub PAT for HTTPS push (writes `git-credentials` at startup) |
| `GIT_CREDENTIALS_URL` | — | Full credentials URL for non-GitHub hosts (e.g., `https://user:token@gitlab.com`) |

### Push Notifications (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `NTFY_TOPIC` | — | [ntfy.sh](https://ntfy.sh) topic name (e.g., `clawd-your-topic`) — enables push notifications |
| `NTFY_SERVER` | `https://ntfy.sh` | ntfy server URL (use default unless self-hosting) |

### Auto-Update Only

| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_BRANCH` | `main` | Git branch to clone on startup |
| `GIT_REPO_URL` | Clawd GitHub repo | Git repository URL to clone |

## Architecture

Clawd uses a dual-protocol communication pattern:

- **REST API** — CRUD operations for sessions, settings, and authentication
- **WebSocket** — Real-time bidirectional communication for streaming messages, tool approvals, and session control

The backend wraps the `@anthropic-ai/claude-agent-sdk`, managing Claude Code subprocesses for each session. Messages flow through a `MessageChannel` (AsyncIterable bridge) that connects user input from the WebSocket to the SDK's input stream. SDK output is streamed back to subscribed WebSocket clients token-by-token.

## Security Notes

- Login credentials in `credentials.json` are stored in plain text. Use strong, unique passwords and restrict network access appropriately.
- The `.env`, `credentials.json`, `claude-auth.json`, and `project-folders.json` files are gitignored and should never be committed.
- When deploying on a local network, consider using a reverse proxy with HTTPS (e.g., Caddy, nginx) for encrypted traffic.
- The `JWT_SECRET` is auto-generated on each server start if not explicitly set, which invalidates existing sessions on restart.

## License

This project is provided as-is for personal use.

---

*Last updated: February 2026*
