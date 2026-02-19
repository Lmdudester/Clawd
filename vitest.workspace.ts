import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: 'packages/server/vitest.config.ts',
    test: { name: 'server' },
  },
  {
    extends: 'packages/client/vitest.config.ts',
    test: { name: 'client' },
  },
  {
    extends: 'packages/session-agent/vitest.config.ts',
    test: { name: 'session-agent' },
  },
]);
