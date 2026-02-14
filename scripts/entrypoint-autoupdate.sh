#!/bin/sh
set -e

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
