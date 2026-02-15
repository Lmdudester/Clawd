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
    printf 'https://git:%s@github.com\n' "$GITHUB_TOKEN" > "$HOME/.git-credentials"
    chmod 600 "$HOME/.git-credentials"
    git config --global credential.helper store
elif [ -n "$GIT_CREDENTIALS_URL" ]; then
    echo "[STARTUP] Configuring git credentials..."
    printf '%s\n' "$GIT_CREDENTIALS_URL" > "$HOME/.git-credentials"
    chmod 600 "$HOME/.git-credentials"
    git config --global credential.helper store
fi

# --- Allow git to operate on volumes with different ownership ---
git config --global --add safe.directory '*'

# --- Host ~/.claude directory symlink (optional) ---
if [ -n "$HOST_CLAUDE_DIR" ]; then
    if [ -d "$HOST_CLAUDE_DIR" ]; then
        echo "[STARTUP] Linking ~/.claude -> $HOST_CLAUDE_DIR"
        rm -rf "$HOME/.claude"
        ln -sf "$HOST_CLAUDE_DIR" "$HOME/.claude"
    else
        echo "[STARTUP] WARNING: HOST_CLAUDE_DIR=$HOST_CLAUDE_DIR not found"
    fi
fi

echo "=== Clawd Auto-Update Startup ==="

# Clean up any previous source directory
if [ -d /app/src ]; then
    echo "[STARTUP] Cleaning up previous source..."
    chmod -R u+rwX /app/src 2>/dev/null || true
    rm -rf /app/src
fi

echo "[STARTUP] Cloning repository..."
git clone --depth 1 --branch "${GIT_BRANCH:-main}" "${GIT_REPO_URL:-https://github.com/Lmdudester/Clawd.git}" /app/src

cd /app/src

echo "[STARTUP] Installing dependencies..."
npm ci

echo "[STARTUP] Building..."
npm run build

echo "[STARTUP] Starting Clawd..."
exec npm start
