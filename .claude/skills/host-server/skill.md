---
name: host-server
description: Pull latest code, rebuild Docker images as needed, and restart the hosted Clawd server
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(docker *), Bash(sleep *)
---

Update and restart the hosted Clawd Docker server. Follow these steps exactly:

## 1. Pull latest code and check container state

First, pull the latest code locally:

```
cd "$(git rev-parse --show-toplevel)" && git pull
```

Then compare the **running container's commit** against the local HEAD. The container clones the repo into `/app/src` at startup:

```
docker exec clawd sh -c "git -C /app/src rev-parse HEAD"
```

Compare this against the local `git rev-parse HEAD`. If they match, the container is already running the latest code. If they differ, use the container's commit as the baseline for the diff in step 2.

## 2. Determine what changed

If the commits differ, run `git diff --name-only <container-commit>..HEAD` to identify changed files. Categorize them using the rules below. If the commits match, all three categories are FALSE.

- **Session image rebuild** if any of these changed:
  - `Dockerfile.session`
  - `packages/session-agent/**`
  - `packages/shared/**`
  - `session-skills/**`
  - `scripts/session-entrypoint.sh`
- **Master image rebuild** if any of these changed:
  - `Dockerfile`
  - `scripts/entrypoint.sh`
- **Master container recreate** if any of these changed (or if master image rebuild is TRUE):
  - `packages/server/**`
  - `packages/client/**`
  - `packages/shared/**`
  - `docker-compose.yml`
  - `.env`

**ALWAYS** present this status table before proceeding, even if everything is up to date:

| Component | Needs Update |
|---|---|
| Session image | TRUE / FALSE |
| Master image | TRUE / FALSE |
| Master container | TRUE / FALSE |

If all three are FALSE, skip to step 4 (health check).

## 3. Rebuild and restart

### Session image (if needed)

```
docker build -t clawd-session:latest -f Dockerfile.session .
```

This only affects future session containers — existing sessions are not impacted.

### Master image (if needed)

```
docker compose build clawd
```

### Master container recreate (if needed)

```
docker compose up -d --force-recreate clawd
```

The master container clones the repo at startup, so code-only changes don't require an image rebuild — just a recreate. Use `--force-recreate` to ensure the container is actually replaced (plain `up -d` will no-op if the container is already running).

**Warning:** Recreating the master server destroys all active Claude Code sessions (they are in-memory only). Inform the user before executing this step and ask for confirmation.

## 4. Health check

Wait 15 seconds for the container to start up (skip the wait if no restart occurred), then verify:

```
docker ps --filter name=clawd --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Also check the recent logs for errors:

```
docker logs clawd --tail 30
```

Report:
- Whether the container is running and healthy
- Whether the server started successfully (look for "Clawd server running" in logs)
- Whether the container manager initialized (look for container manager logs)
- Any errors visible in the output
