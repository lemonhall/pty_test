import { PTYManager, SpawnError } from '../dist/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const manager = new PTYManager({ maxOutputSize: 1024 * 1024 });

  // A short-lived process that prints a line every ~300ms for ~6s.
  const sessionId = manager.spawn(process.execPath, {
    args: [
      '-e',
      `
let i = 0;
const start = Date.now();
const timer = setInterval(() => {
  i += 1;
  console.log('line', i, 'ts', Date.now());
  if (Date.now() - start > 6000) {
    clearInterval(timer);
    process.exit(0);
  }
}, 300);
`
    ]
  });

  console.log('spawned sessionId=', sessionId);

  // "log offset/limit" style consumption:
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = manager.getStatus(sessionId);
    const chunk = manager.readOutput(sessionId, { offset, limit: 1024 });
    if (chunk.truncated) {
      console.log('[log] truncated: jumped offset from', offset, 'to', chunk.offset);
    }
    if (chunk.data) process.stdout.write(chunk.data);
    offset = chunk.nextOffset;

    if (status.status !== 'running') break;
    await sleep(200);
  }

  const final = manager.getStatus(sessionId);
  console.log('\n--- summary ---');
  console.log('status=', final.status, 'exitCode=', final.exitCode);
  console.log('finalOffsets=', manager.readOutput(sessionId, { offset: 0, limit: 0 }).startOffset, manager.readOutput(sessionId, { offset: 0, limit: 0 }).endOffset);
}

try {
  await main();
} catch (err) {
  if (err instanceof SpawnError) {
    console.error('PTY spawn failed:', err.code, err.message);
    console.error('originalError=', err.originalError);
    process.exitCode = 1;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
}

