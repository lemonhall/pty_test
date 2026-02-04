import test from 'node:test';
import assert from 'node:assert/strict';

import { PTYManager, SessionNotFoundError } from '../dist/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakePty {
  pid;
  #dataListeners = [];
  #exitListeners = [];

  constructor(pid) {
    this.pid = pid;
  }

  onData(listener) {
    this.#dataListeners.push(listener);
  }

  onExit(listener) {
    this.#exitListeners.push(listener);
  }

  emitData(data) {
    for (const listener of this.#dataListeners) listener(data);
  }

  emitExit(exitCode = 0) {
    for (const listener of this.#exitListeners) listener({ exitCode });
  }
}

function scriptedProvider(scripts) {
  const queue = [...scripts];
  return {
    spawn(_command, _args, _options) {
      const next = queue.shift();
      if (!next) throw new Error('No scripted PTY available');
      return next();
    }
  };
}

async function waitUntil(fn, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timeout');
    await sleep(intervalMs);
  }
}

test('getOutput throws SessionNotFoundError', async () => {
  const manager = new PTYManager();
  assert.throws(() => manager.getOutput('missing'), SessionNotFoundError);
});

test('spawn + getStatus reports running then exited', { timeout: 5000 }, async () => {
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([
      () => {
        const fake = new FakePty(1234);
        setTimeout(() => fake.emitExit(0), 200);
        return fake;
      }
    ])
  });
  const sessionId = manager.spawn('node', { args: ['-e', '...'] });

  const status1 = manager.getStatus(sessionId);
  assert.equal(status1.sessionId, sessionId);
  assert.equal(status1.command, 'node');
  assert.ok(['running', 'exited', 'killed'].includes(status1.status));

  await waitUntil(() => manager.getStatus(sessionId).status !== 'running', {
    timeoutMs: 4000
  });

  const status2 = manager.getStatus(sessionId);
  assert.ok(status2.endTime instanceof Date);
});

test('captures output', { timeout: 5000 }, async () => {
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([
      () => {
        const fake = new FakePty(2345);
        setTimeout(() => fake.emitData('hello-from-pty\r\n'), 10);
        setTimeout(() => fake.emitExit(0), 50);
        return fake;
      }
    ])
  });
  const sessionId = manager.spawn('node', { args: ['-e', '...'] });

  await waitUntil(() => manager.getOutput(sessionId).includes('hello-from-pty'), {
    timeoutMs: 4000
  });
});

test('output buffer cap keeps latest bytes', { timeout: 5000 }, async () => {
  const payload = 'a'.repeat(4096);
  const manager = new PTYManager({
    maxOutputSize: 1024,
    ptyProvider: scriptedProvider([
      () => {
        const fake = new FakePty(3456);
        setTimeout(() => fake.emitData(payload), 10);
        setTimeout(() => fake.emitExit(0), 20);
        return fake;
      }
    ])
  });
  const sessionId = manager.spawn('node', { args: ['-e', '...'] });

  await waitUntil(() => manager.getStatus(sessionId).status !== 'running', {
    timeoutMs: 4000
  });

  const output = manager.getOutput(sessionId);
  assert.ok(Buffer.byteLength(output, 'utf8') <= 1024);
  const aCount = [...output].filter((c) => c === 'a').length;
  assert.ok(aCount >= 100);
});
