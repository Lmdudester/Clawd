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
const WORKSPACE = '/workspace';

if (!SESSION_ID || !SESSION_TOKEN) {
  console.error('[agent] Missing required env vars: SESSION_ID, SESSION_TOKEN');
  process.exit(1);
}

async function main() {
  // 1. Connect to master
  const masterClient = new MasterClient(MASTER_WS_URL, SESSION_ID!, SESSION_TOKEN!);
  await masterClient.connect();

  // 2. Read .clawd.yml if it exists
  let config: ClawdConfig | undefined;
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
    for (const cmd of config.setup) {
      masterClient.send({ type: 'setup_progress', message: `Running: ${cmd}` });
      console.log(`[agent] Running setup: ${cmd}`);
      try {
        execSync(cmd, {
          cwd: WORKSPACE,
          stdio: 'inherit',
          timeout: 5 * 60 * 1000, // 5 min per command
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

  // 4. Signal ready
  masterClient.send({ type: 'ready' });
  console.log('[agent] Ready, starting SDK...');

  // 5. Start SDK runner
  const runner = new SDKRunner({
    cwd: WORKSPACE,
    permissionMode: PERMISSION_MODE,
    masterClient,
    config,
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
