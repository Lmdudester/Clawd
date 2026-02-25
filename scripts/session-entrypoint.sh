#!/bin/sh
set -e

# 1. Git credentials — token is on the secrets volume, not in env
GITHUB_TOKEN="${GITHUB_TOKEN:-$(cat /run/secrets/github-token 2>/dev/null)}"
if [ -n "$GITHUB_TOKEN" ]; then
    printf 'https://git:%s@github.com\n' "$GITHUB_TOKEN" > "$HOME/.git-credentials"
    chmod 600 "$HOME/.git-credentials"
    git config --global credential.helper store
fi
if [ -n "$GIT_USER_NAME" ]; then
    git config --global user.name "$GIT_USER_NAME"
    git config --global user.email "${GIT_USER_EMAIL:-$GIT_USER_NAME@users.noreply.github.com}"
fi

# Allow git to operate on volumes with different ownership
git config --global --add safe.directory '*'

# 2. Clone repo + branch (skip for manager sessions)
if [ "$MANAGER_MODE" = "true" ]; then
    echo "[session] Manager mode — skipping repo clone"
    mkdir -p /workspace
else
    if [ -n "$GIT_REPO_URL" ]; then
        echo "[session] Cloning $GIT_REPO_URL (branch: ${GIT_BRANCH:-main})..."
        git clone --depth 1 --branch "${GIT_BRANCH:-main}" -- "$GIT_REPO_URL" /workspace
    fi
fi
cd /workspace

# 3. Start session agent
echo "[session] Starting session agent..."
exec node /session-agent/packages/session-agent/dist/index.js
