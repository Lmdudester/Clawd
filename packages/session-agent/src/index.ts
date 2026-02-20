// Session Agent entry point.
// Runs inside each session container, connects to the master server,
// optionally reads .clawd.yml, runs setup commands, then starts the SDK.

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { MasterClient } from './master-client.js';
import { SDKRunner } from './sdk-runner.js';
import type { ClawdConfig, PermissionMode } from '@clawd/shared';

const SESSION_ID = process.env.SESSION_ID;
const SESSION_TOKEN = process.env.SESSION_TOKEN;
const MASTER_WS_URL = process.env.MASTER_WS_URL || 'ws://clawd:4000/internal/session';
const PERMISSION_MODE = (process.env.PERMISSION_MODE || 'normal') as PermissionMode;
const MANAGER_MODE = process.env.MANAGER_MODE === 'true';
const WORKSPACE = '/workspace';

if (!SESSION_ID || !SESSION_TOKEN) {
  console.error('[agent] Missing required env vars: SESSION_ID, SESSION_TOKEN');
  process.exit(1);
}

async function main() {
  // 1. Connect to master
  const masterClient = new MasterClient(MASTER_WS_URL, SESSION_ID!, SESSION_TOKEN!);
  await masterClient.connect();

  // 2. Read .clawd.yml if it exists (skip for manager sessions — no repo)
  let config: ClawdConfig | undefined;
  if (!MANAGER_MODE) {
    const configPath = `${WORKSPACE}/.clawd.yml`;
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        config = parseYaml(raw) as ClawdConfig;
        console.log('[agent] Loaded .clawd.yml');
      } catch (err: any) {
        console.warn(`[agent] Failed to parse .clawd.yml: ${err.message}`);
        masterClient.send({ type: 'setup_progress', message: `Warning: Failed to parse .clawd.yml: ${err.message}` });
      }
    }

    // 3. Run setup commands from .clawd.yml
    if (config?.setup && config.setup.length > 0) {
      // Strip known sensitive Clawd env vars to prevent secret exfiltration.
      // Uses an explicit denylist rather than a broad regex so that legitimate
      // vars like NPM_TOKEN or GPG_KEY are still available to setup commands.
      const sensitiveNames = new Set([
        'GITHUB_TOKEN',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'SESSION_TOKEN',
        'ANTHROPIC_API_KEY',
        'SESSION_AUTH_TOKEN',
        'GH_TOKEN',
      ]);
      const strippedVars = Object.keys(process.env).filter((key) => sensitiveNames.has(key));
      if (strippedVars.length > 0) {
        console.log(`[agent] Stripped sensitive env vars from setup environment: ${strippedVars.join(', ')}`);
      }
      const filteredEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !sensitiveNames.has(key))
      );

      for (const cmd of config.setup) {
        masterClient.send({ type: 'setup_progress', message: `Running: ${cmd}` });
        console.log(`[agent] Running setup: ${cmd}`);
        try {
          execSync(cmd, {
            cwd: WORKSPACE,
            stdio: 'inherit',
            timeout: 5 * 60 * 1000, // 5 min per command
            env: filteredEnv,
          });
        } catch (err: any) {
          const errMsg = `Setup command failed: ${cmd} — ${err.message}`;
          console.error(`[agent] ${errMsg}`);
          masterClient.send({ type: 'setup_progress', message: errMsg });
          masterClient.send({ type: 'error', message: errMsg });
          process.exit(1);
        }
      }
      masterClient.send({ type: 'setup_progress', message: 'Setup complete' });
    }
  }

  // 4. Signal ready
  masterClient.send({ type: 'ready' });
  console.log('[agent] Ready, starting SDK...');

  // 5. Start SDK runner
  if (MANAGER_MODE) {
    console.log('[agent] Starting in MANAGER mode');
  }

  const runner = new SDKRunner({
    cwd: WORKSPACE,
    permissionMode: PERMISSION_MODE,
    masterClient,
    config,
    managerMode: MANAGER_MODE,
  });

  // Wire master messages to SDK runner
  masterClient.onMessage((message) => {
    runner.handleMasterMessage(message);
  });

  // Run the SDK (blocks until done or aborted)
  await runner.run();

  console.log('[agent] SDK runner finished, exiting');
  masterClient.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err);
  process.exit(1);
});
