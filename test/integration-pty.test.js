import test from 'node:test';
import assert from 'node:assert/strict';

import { PTYManager } from '../dist/index.js';

const shouldRun = process.env.RUN_PTY_INTEGRATION === '1';
const maybeTest = shouldRun ? test : test.skip;

maybeTest('node-pty integration: spawn captures output', { timeout: 10000 }, async () => {
  const manager = new PTYManager();
  const sessionId = manager.spawn(process.execPath, {
    args: ['-e', "console.log('hello-from-real-pty'); setTimeout(() => process.exit(0), 20)"]
  });

  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (manager.getOutput(sessionId).includes('hello-from-real-pty')) break;
    if (Date.now() - start > 9000) throw new Error('timeout waiting for output');
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.ok(manager.getOutput(sessionId).includes('hello-from-real-pty'));
});

