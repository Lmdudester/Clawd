#!/bin/bash
# cleanup-test-clawd.sh — Tear down a test Clawd instance and its session containers.
#
# Usage:
#   bash scripts/cleanup-test-clawd.sh <container-name>
#
# This removes:
#   1. All session containers spawned by the test instance (by instance ID label)
#   2. The test master container itself

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: cleanup-test-clawd.sh <container-name>" >&2
  echo "  e.g. cleanup-test-clawd.sh test-clawd-1700000000" >&2
  exit 1
fi

CONTAINER_NAME="$1"

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not accessible." >&2
  exit 1
fi

# ── Discover instance ID from the container's labels ─────────────
INSTANCE_ID=$(docker inspect --format '{{ index .Config.Labels "clawd.instance.id" }}' "${CONTAINER_NAME}" 2>/dev/null || true)

if [[ -z "$INSTANCE_ID" ]]; then
  echo "WARNING: Could not read instance ID from container labels. Removing container only." >&2
else
  echo "Instance ID: ${INSTANCE_ID}"

  # Remove session containers spawned by this test instance
  SESSION_CONTAINERS=$(docker ps -aq --filter "label=clawd.instance.id=${INSTANCE_ID}" --filter "label=clawd.session=true" 2>/dev/null || true)

  if [[ -n "$SESSION_CONTAINERS" ]]; then
    echo "Removing session containers for instance ${INSTANCE_ID}..."
    echo "$SESSION_CONTAINERS" | xargs docker rm -f 2>/dev/null || true
  else
    echo "No session containers found for instance ${INSTANCE_ID}."
  fi
fi

# ── Remove the test master container ─────────────────────────────
echo "Removing test master container: ${CONTAINER_NAME}..."
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

echo "Cleanup complete."
