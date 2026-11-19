import assert from 'node:assert/strict';
import { runOptionalStartupActions } from '../startupPolicy.js';

for (const [env, expected] of [
  [{}, ['restore']],
  [{RUN_DATABASE_INITIALIZATION_ON_STARTUP: 'TRUE', RESTORE_WHATSAPP_SESSIONS_ON_STARTUP:'false'}, []],
  [{ RUN_DATABASE_INITIALIZATION_ON_STARTUP: 'true', RESTORE_WHATSAPP_SESSIONS_ON_STARTUP:'false' }, ['initialize']],
  [{ RESTORE_WHATSAPP_SESSIONS_ON_STARTUP: 'true' }, ['restore']],
  [{ RUN_DATABASE_INITIALIZATION_ON_STARTUP: 'true', RESTORE_WHATSAPP_SESSIONS_ON_STARTUP: 'true' }, ['initialize', 'restore']],
] as const) {
  const calls: string[] = [];
  await runOptionalStartupActions(env, {
    initializeDatabase: async () => { calls.push('initialize'); },
    restoreWhatsAppSessions: async () => { calls.push('restore'); },
    log: () => {},
  });
  assert.deepEqual(calls, expected);
}
let restoredAfterFailure = false;
await assert.rejects(runOptionalStartupActions({ RUN_DATABASE_INITIALIZATION_ON_STARTUP: 'true', RESTORE_WHATSAPP_SESSIONS_ON_STARTUP: 'true' }, {
  initializeDatabase: async () => { throw new Error('test failure'); },
  restoreWhatsAppSessions: async () => { restoredAfterFailure = true; },
  log: () => {},
}), /test failure/);
assert.equal(restoredAfterFailure, false, 'Initialization failure must not proceed to messaging');
console.log('Startup policy: 6 cases passed, saved auth restores independently of accounting initialization. No real database or messaging transport used.');
