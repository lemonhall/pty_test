import test from 'node:test';
import assert from 'node:assert/strict';

import { PTYManager } from '../dist/index.js';

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

test('readOutput supports offset/limit', async () => {
  const fake = new FakePty(1);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });
  const id = manager.spawn('cmd');

  fake.emitData('hello');
  fake.emitData(' world');

  const a = manager.readOutput(id, { offset: 0, limit: 5 });
  assert.equal(a.data, 'hello');
  assert.equal(a.offset, 0);
  assert.equal(a.nextOffset > a.offset, true);

  const b = manager.readOutput(id, { offset: a.nextOffset, limit: 1024 });
  assert.equal(b.data, ' world');
});

test('log() matches process log shape', async () => {
  const fake = new FakePty(10);
  const manager = new PTYManager({
    ptyProvider: scriptedProvider([() => fake])
  });
  const id = manager.spawn('cmd');

  fake.emitData('abc');
  const chunk = manager.log(id, { offset: 0, limit: 1024 });
  assert.equal(chunk.output, 'abc');
  assert.equal(chunk.offset, 0);
  assert.equal(chunk.nextOffset > chunk.offset, true);
});

test('readOutput reports truncation when ring buffer drops old bytes', async () => {
  const fake = new FakePty(2);
  const manager = new PTYManager({
    maxOutputSize: 10,
    ptyProvider: scriptedProvider([() => fake])
  });
  const id = manager.spawn('cmd');

  fake.emitData('0123456789'); // 10 bytes
  fake.emitData('ABCDE'); // overflow => oldest dropped

  const chunk = manager.readOutput(id, { offset: 0, limit: 1024 });
  assert.equal(chunk.truncated, true);
  assert.equal(chunk.offset, chunk.startOffset);
  assert.ok(chunk.data.length > 0);
  assert.ok(chunk.endOffset >= chunk.nextOffset);
});

test('readOutput does not stall when startOffset cuts UTF-8 sequence', async () => {
  const fake = new FakePty(3);
  const manager = new PTYManager({
    // Small enough to force trimming mid-character.
    maxOutputSize: 4,
    ptyProvider: scriptedProvider([() => fake])
  });
  const id = manager.spawn('cmd');

  // "你" is 3 bytes in UTF-8. This will force the buffer to start mid-sequence.
  fake.emitData('你你'); // 6 bytes => drop 2 bytes => startOffset=2 (likely continuation)

  const first = manager.readOutput(id, { offset: 0, limit: 1024 });
  assert.equal(first.truncated, true);
  assert.equal(first.offset, first.startOffset);
  assert.equal(first.nextOffset, first.endOffset);
});
