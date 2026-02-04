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
  killed = false;

  constructor(pid) {
    this.pid = pid;
  }

  onData(listener) {
    this.#dataListeners.push(listener);
  }

  onExit(listener) {
    this.#exitListeners.push(listener);
  }

  kill(_signal) {
    this.killed = true;
    setTimeout(() => this.emitExit(0), 10);
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

test('listSessions returns all sessions', async () => {
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => new FakePty(1), () => new FakePty(2)])
  });
  const a = manager.spawn('cmd-a');
  const b = manager.spawn('cmd-b');
  const sessions = manager.listSessions();
  assert.equal(sessions.length, 2);
  assert.ok(sessions.some((s) => s.sessionId === a));
  assert.ok(sessions.some((s) => s.sessionId === b));
});

test('cleanup removes ended sessions', { timeout: 5000 }, async () => {
  let fake;
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([
      () => {
        fake = new FakePty(10);
        setTimeout(() => fake.emitExit(0), 10);
        return fake;
      }
    ])
  });

  const id = manager.spawn('cmd');
  await waitUntil(() => manager.getStatus(id).status !== 'running', { timeoutMs: 4000 });

  const removed = manager.cleanup();
  assert.deepEqual(removed, [id]);
  assert.equal(manager.listSessions().length, 0);
});

test('sessionTTL auto-removes ended sessions', { timeout: 5000 }, async () => {
  const manager = new PTYManager({
    sessionTTL: 50,
    ptyProvider: scriptedProvider([
      () => {
        const fake = new FakePty(20);
        setTimeout(() => fake.emitExit(0), 10);
        return fake;
      }
    ])
  });

  const id = manager.spawn('cmd');
  await waitUntil(() => manager.getStatus(id).status !== 'running', { timeoutMs: 4000 });
  await sleep(120);

  const sessions = manager.listSessions();
  assert.equal(sessions.length, 0);
});

test('destroy kills running sessions and clears manager', { timeout: 5000 }, async () => {
  const fake = new FakePty(30);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });

  manager.spawn('cmd');
  manager.destroy();

  assert.equal(fake.killed, true);
  assert.equal(manager.listSessions().length, 0);
});

