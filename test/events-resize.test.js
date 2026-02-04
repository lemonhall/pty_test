import test from 'node:test';
import assert from 'node:assert/strict';

import { PTYManager } from '../dist/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

class FakePty {
  pid;
  #dataListeners = [];
  #exitListeners = [];
  resizedTo = null;

  constructor(pid) {
    this.pid = pid;
  }

  onData(listener) {
    this.#dataListeners.push(listener);
  }

  onExit(listener) {
    this.#exitListeners.push(listener);
  }

  resize(cols, rows) {
    this.resizedTo = { cols, rows };
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

test('output event emits sessionId + data', { timeout: 5000 }, async () => {
  const fake = new FakePty(1);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });

  const seen = [];
  manager.on('output', (sessionId, data) => seen.push({ sessionId, data }));

  const id = manager.spawn('cmd');
  setTimeout(() => fake.emitData('hello'), 10);

  await waitUntil(() => seen.length === 1, { timeoutMs: 4000 });
  assert.equal(seen[0].sessionId, id);
  assert.equal(seen[0].data, 'hello');
});

test('exit event emits once with sessionId + exitCode', { timeout: 5000 }, async () => {
  const fake = new FakePty(2);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });

  const seen = [];
  manager.on('exit', (sessionId, exitCode) => seen.push({ sessionId, exitCode }));

  const id = manager.spawn('cmd');
  setTimeout(() => fake.emitExit(7), 10);

  await waitUntil(() => seen.length === 1, { timeoutMs: 4000 });
  assert.equal(seen[0].sessionId, id);
  assert.equal(seen[0].exitCode, 7);
});

test('resize calls underlying pty.resize', async () => {
  const fake = new FakePty(3);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });

  const id = manager.spawn('cmd');
  manager.resize(id, 120, 40);
  assert.deepEqual(fake.resizedTo, { cols: 120, rows: 40 });
});

