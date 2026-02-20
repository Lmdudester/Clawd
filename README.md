# Clawd

A web-based remote interface for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's CLI coding assistant. Run Claude Code sessions in isolated Docker containers and interact with them from any browser on your local network — including mobile devices.

## Features

- **Per-session Docker containers** — Each session runs in its own isolated container with full tooling (Git, Python, GitHub CLI, Playwright, etc.), preventing sessions from interfering with each other
- **Branch-aware session creation** — Select a repository and branch (or create a new one) when starting a session; the container clones the repo automatically
- **Project configuration** — Repositories can include a `.clawd.yml` file to define setup commands, environment variables, and MCP servers that run automatically when a session starts
- **Real-time streaming** — Messages stream token-by-token over WebSocket with a live typing indicator
- **Tool approval workflow** — Approve or deny each tool call (Bash, Edit, Read, etc.) before Claude executes it
- **Permission modes** — Per-session permission control:
  - *Normal* — Prompt for each tool use
  - *Auto Edits* — Auto-approve file edits within the project directory, prompt for everything else
  - *Auto Accept* — Automatically approve all tool calls
  - *Plan* — Deny all tool calls, forcing Claude to describe rather than execute
- **Model switching** — Switch between available Claude models mid-session
- **API usage monitoring** — Real-time Anthropic API rate limit display with color-coded progress bars
- **OAuth authentication** — Use OAuth credentials from an existing Claude CLI installation (Claude Max) with automatic token refresh
- **Project repo bookmarks** — Save frequently-used repositories for quick session creation
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
│   ├── shared/              # Shared TypeScript types (client + server + agent)
│   ├── server/              # Express + WebSocket backend (master)
│   │   └── src/
│   │       ├── auth/            # JWT authentication middleware
│   │       ├── routes/          # REST API endpoints (sessions, repos, settings)
│   │       ├── sessions/        # Session & container lifecycle management
│   │       ├── settings/        # Credential & repo persistence
│   │       └── ws/              # Client & internal WebSocket handlers
│   ├── session-agent/       # Agent process running inside each session container
│   │   └── src/
│   │       ├── index.ts         # Entrypoint: connects to master, runs setup, starts SDK
│   │       ├── sdk-runner.ts    # Claude Agent SDK wrapper with tool approval logic
│   │       └── master-client.ts # WebSocket client for master communication
│   └── client/              # React SPA frontend
│       └── src/
│           ├── components/      # UI components (chat, sessions, settings)
│           ├── hooks/           # Custom React hooks
│           ├── stores/          # Zustand state management
│           └── lib/             # API client utilities
├── session-skills/          # Skills baked into every session container
├── scripts/                 # Docker entrypoint scripts
├── Dockerfile               # Master server container
├── Dockerfile.session       # Session container (full dev environment)
└── docker-compose.yml       # Docker Compose configuration
```

## Architecture

Clawd uses a **master/agent** architecture with per-session Docker containers:

```
┌──────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  Browser  │◄──►│    Master Server     │◄──►│  Session Container  │
│  (React)  │ WS │  (Express + WS)      │ WS │  (session-agent)    │
│           │    │                      │    │                     │
│           │    │  - REST API          │    │  - Claude Agent SDK │
│           │    │  - Client WebSocket  │    │  - Tool approval    │
│           │    │  - Container manager │    │  - .clawd.yml setup │
│           │    │  - Internal WS       │    │  - Git, Python, etc │
└──────────┘     └──────────────────────┘     └─────────────────────┘
                          │                          ▲
                          │  Docker API               │ git clone
                          ▼                          │
                 ┌──────────────────┐        ┌──────────────┐
                 │  Docker Engine   │        │  Git Remote   │
                 └──────────────────┘        └──────────────┘
```

1. The **master server** handles authentication, serves the frontend, and manages session container lifecycles via the Docker API
2. When a session is created, the master starts a **session container** from the `clawd-session` image, which clones the target repo/branch and launches the **session agent**
3. The session agent connects back to the master via an **internal WebSocket**, runs the Claude Agent SDK, and relays messages, tool approvals, and streaming tokens
4. The **browser client** communicates with the master via REST API and a client-facing WebSocket

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
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
   {
     "users": [
       { "username": "your-username", "password": "your-password" }
     ]
   }
   EOF
   ```

3. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

4. **Update `docker-compose.yml`** volume mounts to match your host filesystem:

   ```yaml
   volumes:
     - /var/run/docker.sock:/var/run/docker.sock  # Required for session containers
     - /c:/host/c                                  # Mount your host drive
     - ./credentials.json:/app/credentials.json:ro # Mount credentials
   ```

5. **Build and start** (builds both the master and session images):

   ```bash
   docker compose up -d --build
   ```

6. **Open** `http://localhost:4000` in your browser and log in with the credentials you configured.

> **Note:** The master container clones the latest code, installs dependencies, and builds on every start — so it always runs the newest version. The session container image (`clawd-session:latest`) is built separately and contains all development tooling.

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

3. **Rebuild and restart:**

   ```bash
   docker compose up -d --build
   ```

The entrypoint script configures `git config --global` identity and credential storage at startup. All session containers inherit these settings automatically.

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

### Project Configuration (.clawd.yml)

Repositories can include a `.clawd.yml` file at their root to configure session setup automatically. When a session starts, the agent reads this file and applies the configuration before accepting user input.

```yaml
# .clawd.yml — optional project configuration for Clawd sessions

# Commands to run after cloning (dependency install, build, etc.)
setup:
  - npm install
  - npm run build

# Extra environment variables for the Claude SDK process
env:
  DATABASE_URL: postgres://localhost:5432/mydb

# Additional MCP servers (Playwright is always included by default)
mcp:
  my-server:
    command: npx
    args: [my-mcp-server, --flag]
```

### Session Container Tooling

Each session container comes pre-installed with:

- **Node.js 22** + npm + pnpm (via corepack)
- **Python 3** + pip + venv
- **Git** + **GitHub CLI** (`gh`)
- **Playwright** (Chromium) via MCP server
- **ripgrep**, **jq**, **sqlite3**, **tree**
- **Claude Code CLI** (`@anthropic-ai/claude-code`)

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

   # Create credentials.json with your login credentials
   echo '{"users": [{"username": "dev", "password": "dev"}]}' > credentials.json
   ```

3. **Start the dev servers:**

   ```bash
   npm run dev
   ```

   This runs both the backend (port 3050) and Vite dev server (port 3051) concurrently. Open `http://localhost:3051` for development with hot reload.

### Build

```bash
npm run build   # Build shared types, client, server, and session-agent
npm start       # Start the production server
```

### Rebuilding the Session Image

After making changes to the `session-agent` package or `Dockerfile.session`:

```bash
docker build -f Dockerfile.session -t clawd-session:latest .
```

Running sessions use the image they started with; new sessions will pick up the updated image.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWD_HOST` | `localhost` | Server bind address (`0.0.0.0` for Docker/LAN access) |
| `CLAWD_PORT` | `3050` | Server port |
| `HOST_DRIVE_PREFIX` | — | Container path prefix for host drive mount (e.g., `/host/c`) |
| `JWT_SECRET` | Auto-generated | JWT signing secret (tokens invalidate on restart if not set) |
| `CREDENTIALS_PATH` | `./credentials.json` | Path to the login credentials file |
| `PROJECT_REPOS_PATH` | `./project-repos.json` | Path to the project repos config file |

### Docker Session Containers

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWD_SESSION_IMAGE` | `clawd-session:latest` | Docker image to use for session containers |
| `CLAWD_NETWORK` | `clawd-network` | Docker network for master/session communication |
| `SESSION_MEMORY_LIMIT` | `4294967296` (4 GB) | Per-session memory limit in bytes |
| `SESSION_CPU_SHARES` | `512` | Per-session CPU shares (relative weight) |
| `SESSION_PIDS_LIMIT` | `256` | Per-session process limit |

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

### Auto-Update

| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_BRANCH` | `main` | Git branch to clone on startup |
| `GIT_REPO_URL` | Clawd GitHub repo | Git repository URL to clone |

## Security Notes

- Login credentials in `credentials.json` are stored in plain text. Use strong, unique passwords and restrict network access appropriately.
- The `.env`, `credentials.json`, `claude-auth.json`, and `project-repos.json` files are gitignored and should never be committed.
- The master container requires access to the Docker socket (`/var/run/docker.sock`) to manage session containers. This grants significant system access — only run on trusted networks.
- When deploying on a local network, consider using a reverse proxy with HTTPS (e.g., Caddy, nginx) for encrypted traffic.
- The `JWT_SECRET` is auto-generated on each server start if not explicitly set, which invalidates existing sessions on restart.
- Session containers are resource-limited by default (4 GB memory, 256 processes) to prevent runaway sessions from affecting the host.

## License

This project is provided as-is for personal use.

---

*Last updated: February 2026*
