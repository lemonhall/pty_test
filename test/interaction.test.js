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
  lastWrite = null;
  lastKill = null;

  constructor(pid) {
    this.pid = pid;
  }

  onData(listener) {
    this.#dataListeners.push(listener);
  }

  onExit(listener) {
    this.#exitListeners.push(listener);
  }

  write(data) {
    this.lastWrite = data;
    this.emitData(`echo:${data}`);
  }

  kill(signal) {
    this.lastKill = signal ?? null;
    setTimeout(() => this.emitExit(0), 10);
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

test('write sends text to running session', async () => {
  const fake = new FakePty(1111);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });
  const sessionId = manager.spawn('node', { args: ['-e', '...'] });

  const result = manager.write(sessionId, 'hi');
  assert.equal(result.success, true);
  assert.equal(fake.lastWrite, 'hi');

  await waitUntil(() => manager.getOutput(sessionId).includes('echo:hi'));
});

test('write returns error when session not running', { timeout: 5000 }, async () => {
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([
      () => {
        const fake = new FakePty(2222);
        setTimeout(() => fake.emitExit(0), 10);
        return fake;
      }
    ])
  });
  const sessionId = manager.spawn('node', { args: ['-e', '...'] });

  await waitUntil(() => manager.getStatus(sessionId).status !== 'running', { timeoutMs: 4000 });

  const result = manager.write(sessionId, 'nope');
  assert.equal(result.success, false);
  assert.equal(result.error, 'SESSION_NOT_RUNNING');
});

test('kill terminates running session and status becomes killed', { timeout: 5000 }, async () => {
  const fake = new FakePty(3333);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });
  const sessionId = manager.spawn('node', { args: ['-e', '...'] });

  const result = manager.kill(sessionId, 'SIGTERM');
  assert.equal(result.success, true);
  assert.equal(fake.lastKill, 'SIGTERM');

  await waitUntil(() => manager.getStatus(sessionId).status !== 'running', { timeoutMs: 4000 });
  assert.equal(manager.getStatus(sessionId).status, 'killed');
});

