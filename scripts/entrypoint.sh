#!/bin/sh
set -e

# --- Git identity and credential setup (optional) ---
if [ -n "$GIT_USER_NAME" ]; then
    echo "[STARTUP] Configuring git identity..."
    git config --global user.name "$GIT_USER_NAME"
    git config --global user.email "${GIT_USER_EMAIL:-$GIT_USER_NAME@users.noreply.github.com}"
fi

if [ -n "$GITHUB_TOKEN" ]; then
    echo "[STARTUP] Configuring GitHub credentials..."
    printf 'https://git:%s@github.com\n' "$GITHUB_TOKEN" > /root/.git-credentials
    chmod 600 /root/.git-credentials
    git config --global credential.helper store
elif [ -n "$GIT_CREDENTIALS_URL" ]; then
    echo "[STARTUP] Configuring git credentials..."
    printf '%s\n' "$GIT_CREDENTIALS_URL" > /root/.git-credentials
    chmod 600 /root/.git-credentials
    git config --global credential.helper store
fi

exec "$@"
