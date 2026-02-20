FROM node:22-bookworm

# ── System packages (minimal — session containers have the full set) ──
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        jq \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
RUN mkdir -p /app/src

WORKDIR /app

# Copy entrypoint and fix line endings
COPY scripts/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Set up non-root user + Docker socket access (socket is root:root on Docker Desktop)
RUN mkdir -p /home/node/.claude \
    && echo '{"hasCompletedOnboarding":true}' > /home/node/.claude.json \
    && chown -R node:node /app /home/node/.claude /home/node/.claude.json

USER node
ENV HOME=/home/node
RUN git config --global --add safe.directory '*'

EXPOSE 4000

ENTRYPOINT ["/entrypoint.sh"]
