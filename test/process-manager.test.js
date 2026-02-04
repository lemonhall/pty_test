import test from 'node:test';
import assert from 'node:assert/strict';

import { ProcessManager } from '../dist/index.js';

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
    this.emitData(data);
  }

  kill(signal) {
    this.lastKill = signal ?? null;
    this.emitExit(137);
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

test('ProcessManager list/poll/log/write/send-keys/kill basic flow', async () => {
  const fake = new FakePty(123);
  const pm = new ProcessManager({
    ptyManagerOptions: { ptyProvider: scriptedProvider([() => fake]) },
    cleanupMs: 50
  });

  const id = pm.spawn('cmd', { args: [] });

  const list1 = pm.process({ action: 'list' });
  assert.equal(list1.details.status, 'completed');

  const write = pm.process({ action: 'write', sessionId: id, data: 'hello\n' });
  assert.equal(write.details.status, 'running');

  const poll = pm.process({ action: 'poll', sessionId: id });
  assert.equal(poll.details.status, 'running');
  assert.ok(poll.content[0].text.includes('hello'));

  const log = pm.process({ action: 'log', sessionId: id, offset: 0, limit: 10 });
  assert.equal(log.details.status, 'running');
  assert.ok(log.content[0].text.includes('hello'));

  const keys = pm.process({ action: 'send-keys', sessionId: id, keys: ['esc', 'enter'] });
  assert.equal(keys.details.status, 'running');
  assert.ok(fake.lastWrite.includes('\x1b'));

  const killed = pm.process({ action: 'kill', sessionId: id });
  assert.equal(killed.details.status, 'failed');
  assert.equal(fake.lastKill, 'SIGKILL');

  const list2 = pm.process({ action: 'list' });
  assert.equal(list2.details.status, 'completed');
});

