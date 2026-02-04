import { PTYManager, SpawnError } from '../dist/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(manager, sessionId, timeoutMs = 10_000) {
  let done = false;
  let exitCode = null;

  manager.on('exit', (id, code) => {
    if (id !== sessionId) return;
    done = true;
    exitCode = code;
  });

  const start = Date.now();
  while (!done) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for exit');
    await sleep(50);
  }

  return exitCode;
}

try {
  const manager = new PTYManager({ maxOutputSize: 1024 * 1024 });

  const examplesDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(examplesDir, '..');
  const targetFile = 'examples/vim-demo.txt';

  const sessionId = manager.spawn('vim', {
    args: [
      '--noplugin',
      '-u',
      'NONE',
      '-i',
      'NONE',
      '-n',
      // 用一个固定的小文件，避免 cwd/文件名歧义
      targetFile
    ],
    cwd: repoRoot,
    cols: 120,
    rows: 40
  });

  console.log('spawned vim sessionId=', sessionId);
  console.log('vim cwd=', repoRoot);
  console.log('vim file=', targetFile);

  // vim 是全屏程序：这里不实时打印 output，避免刷屏；只统计一下数据量。
  let seenBytes = 0;
  manager.on('output', (id, data) => {
    if (id !== sessionId) return;
    seenBytes += Buffer.byteLength(data, 'utf8');
  });

  // 给 vim 一点启动时间，然后发送退出按键：
  // Esc -> :q! -> Enter
  await sleep(600);
  manager.write(sessionId, '\x1b');
  await sleep(100);
  manager.write(sessionId, ':q!\r');

  const exitCode = await waitForExit(manager, sessionId);
  const status = manager.getStatus(sessionId);
  const output = manager.getOutput(sessionId);

  console.log('--- summary ---');
  console.log('exitCode=', exitCode);
  console.log('status=', status.status, 'pid=', status.pid);
  console.log('seenBytes(via events)=', seenBytes);
  console.log('capturedBytes(buffer)=', status.outputLength);
  console.log('tail(raw ansi)=');
  console.log(output.slice(-400));
} catch (err) {
  if (err instanceof SpawnError) {
    console.error('PTY spawn failed:', err.code, err.message);
    console.error('originalError=', err.originalError);
    console.error("If you're in WSL/container, check PTY/devpts permissions; try running in a normal terminal environment.");
    process.exitCode = 1;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
}
