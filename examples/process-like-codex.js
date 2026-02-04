import { ProcessManager, SpawnError } from '../dist/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt() {
  return [
    'Create `index.html` in this directory.',
    '- Single file (no external deps).',
    '- Simple playable keyboard game.',
    '- Add score + restart button.',
    'Then run: ls -la index.html'
  ].join('\n');
}

async function main() {
  const pm = new ProcessManager({
    cleanupMs: 5 * 60 * 1000,
    ptyManagerOptions: { maxOutputSize: 16 * 1024 * 1024 }
  });

  const prompt = buildPrompt();
  const bashCommand = [
    'set -euo pipefail',
    'SCRATCH="$(mktemp -d)"',
    'echo "SCRATCH_DIR=$SCRATCH"',
    'cd "$SCRATCH"',
    'git init -q',
    "codex exec --full-auto --json - <<'CODEX_PROMPT'",
    prompt,
    'CODEX_PROMPT'
  ].join('\n');

  const ptySessionId = pm.spawn('bash', { args: ['-lc', bashCommand], cols: 120, rows: 40 });
  console.log('ptySessionId=', ptySessionId);

  let logOffset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const poll = pm.process({ action: 'poll', sessionId: ptySessionId });
    process.stdout.write(poll.content[0].text + '\n');

    const status = pm.getStatus(ptySessionId);
    if (status.status !== 'running') break;

    // Also show a "log" view (line offset/limit), similar to the SKILL's log tool.
    const log = pm.process({ action: 'log', sessionId: ptySessionId, offset: logOffset, limit: 50 });
    if (log.content[0].text && log.content[0].text !== '(no output yet)') {
      logOffset += 50;
    }

    await sleep(500);
  }
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

