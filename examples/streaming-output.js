import { PTYManager, SpawnError } from '../dist/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(manager, sessionId, timeoutMs = 120_000) {
  let done = false;
  let exitCode = null;

  const onExit = (id, code) => {
    if (id !== sessionId) return;
    done = true;
    exitCode = code;
  };
  manager.on('exit', onExit);

  const start = Date.now();
  while (!done) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for exit');
    await sleep(50);
  }

  return exitCode;
}

try {
  const manager = new PTYManager({ maxOutputSize: 1024 * 1024 });

  const sessionId = manager.spawn(process.execPath, {
    args: [
      '-e',
      `
let i = 0;
const start = Date.now();
function tick() {
  i += 1;
  const elapsed = Math.floor((Date.now() - start) / 1000);
  console.log(\`[tick \${i}] elapsed=\${elapsed}s\`);
  if (Date.now() - start >= 60_000) process.exit(0);
  const jitter = 500 + Math.floor(Math.random() * 2500);
  setTimeout(tick, jitter);
}
tick();
`
    ]
  });

  console.log('spawned sessionId=', sessionId);

  manager.on('output', (id, data) => {
    if (id !== sessionId) return;
    process.stdout.write(data);
  });

  const exitCode = await waitForExit(manager, sessionId);
  const status = manager.getStatus(sessionId);
  const output = manager.getOutput(sessionId);

  console.log('\n--- summary ---');
  console.log('exitCode=', exitCode);
  console.log('status=', status.status, 'pid=', status.pid);
  console.log('capturedBytes=', status.outputLength);
  console.log('tail=');
  console.log(output.slice(-400));
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

