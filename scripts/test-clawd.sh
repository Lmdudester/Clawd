#!/bin/bash
# test-clawd.sh — Spin up a test Clawd instance from within a Docker-enabled session.
#
# Usage:
#   bash scripts/test-clawd.sh [--branch <branch>] [--repo <repo-url>]
#
# Environment (set automatically by session-agent):
#   SESSION_ID — used as the owner label for cleanup tracking
#
# Outputs the test instance URL on success.

set -euo pipefail

# ── Parse arguments ──────────────────────────────────────────────
BRANCH="main"
REPO_URL="https://github.com/Lmdudester/Clawd.git"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --repo)   REPO_URL="$2"; shift 2 ;;
    *)        echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Verify prerequisites ────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not accessible. Was this session created with Docker access?" >&2
  exit 1
fi

for img in clawd:latest clawd-session:latest; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "ERROR: Required image '$img' not found." >&2
    exit 1
  fi
done

if [[ -z "${SESSION_ID:-}" ]]; then
  echo "WARNING: SESSION_ID not set — cleanup tracking will not work." >&2
fi

# ── Generate unique instance name ────────────────────────────────
TIMESTAMP=$(date +%s)
INSTANCE_NAME="test-clawd-${TIMESTAMP}"
INSTANCE_ID="test-${TIMESTAMP}"
NETWORK="clawd-network"

echo "Starting test Clawd instance: ${INSTANCE_NAME}"
echo "  Branch: ${BRANCH}"
echo "  Repo:   ${REPO_URL}"
echo "  Instance ID: ${INSTANCE_ID}"

# ── Create the test master container ─────────────────────────────
docker run -d \
  --name "${INSTANCE_NAME}" \
  --network "${NETWORK}" \
  -e "CLAWD_HOST=0.0.0.0" \
  -e "CLAWD_PORT=5000" \
  -e "CLAWD_INSTANCE_ID=${INSTANCE_ID}" \
  -e "CLAWD_TEST_USER=test" \
  -e "CLAWD_TEST_PASSWORD=test" \
  -e "GIT_REPO_URL=${REPO_URL}" \
  -e "GIT_BRANCH=${BRANCH}" \
  -e "CLAWD_SESSION_IMAGE=clawd-session:latest" \
  -e "CLAWD_NETWORK=${NETWORK}" \
  -e "CLAWD_MASTER_HOSTNAME=${INSTANCE_NAME}" \
  -e "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}" \
  -e "GITHUB_TOKEN=${GITHUB_TOKEN:-}" \
  -e "GIT_USER_NAME=${GIT_USER_NAME:-}" \
  -e "GIT_USER_EMAIL=${GIT_USER_EMAIL:-}" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -l "clawd.test-instance=true" \
  -l "clawd.test-instance.owner=${SESSION_ID:-unknown}" \
  -l "clawd.instance.id=${INSTANCE_ID}" \
  clawd:latest

echo "Container started. Waiting for server to be ready..."

# ── Wait for the server to respond ───────────────────────────────
MAX_WAIT=180  # 3 minutes (clone + npm ci + build + start)
ELAPSED=0
URL="http://${INSTANCE_NAME}:5000"

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  if docker exec "${INSTANCE_NAME}" curl -sf "http://localhost:5000/api/auth/login" -X POST \
      -H "Content-Type: application/json" \
      -d '{"username":"test","password":"test"}' >/dev/null 2>&1; then
    echo ""
    echo "Test Clawd instance is ready!"
    echo "  URL: ${URL}"
    echo "  Login: test / test"
    echo "  Container: ${INSTANCE_NAME}"
    echo "  Instance ID: ${INSTANCE_ID}"
    exit 0
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  printf "."
done

echo ""
echo "ERROR: Test instance did not become ready within ${MAX_WAIT}s." >&2
echo "Check logs: docker logs ${INSTANCE_NAME}" >&2
exit 1
