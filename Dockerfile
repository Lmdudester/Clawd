FROM node:22-bookworm

# ── System packages ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
        sqlite3 \
        ripgrep \
        tree \
        jq \
        procps \
        lsof \
        zip \
    && rm -rf /var/lib/apt/lists/*

# ── pnpm via corepack (bundled with Node.js 22) ─────────────────
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install Playwright MCP server globally and Chromium + system deps
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npm install -g @playwright/mcp \
    && npx --package=@playwright/mcp playwright install --with-deps chromium \
    && chmod -R o+rwx /opt/playwright-browsers

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build shared types, then client, then server
RUN npm run build

# Copy entrypoint and fix line endings
COPY scripts/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Set up non-root user (Claude Code rejects --dangerously-skip-permissions as root)
RUN mkdir -p /home/node/.claude \
    && echo '{"hasCompletedOnboarding":true}' > /home/node/.claude.json \
    && chown -R node:node /app /home/node/.claude /home/node/.claude.json

USER node
ENV HOME=/home/node
RUN git config --global --add safe.directory '*'

# Expose the server port
EXPOSE 4000

# Start the server (serves built client as static files)
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
