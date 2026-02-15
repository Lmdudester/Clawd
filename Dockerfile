FROM node:22-bookworm

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Pre-create Claude config to bypass onboarding prompt when using OAuth
RUN mkdir -p /root/.claude && echo '{"hasCompletedOnboarding":true}' > /root/.claude.json

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

# Expose the server port
EXPOSE 3000

# Start the server (serves built client as static files)
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
