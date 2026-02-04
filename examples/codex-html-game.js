import { PTYManager, SpawnError } from '../dist/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryExtractSessionId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const anyObj = /** @type {any} */ (obj);
  const candidates = [
    anyObj.session_id,
    anyObj.sessionId,
    anyObj.session?.id,
    anyObj.session?.session_id,
    anyObj.session?.sessionId
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

function tryExtractSessionIdFromTextLine(line) {
  // Codex CLI human-readable banner often includes:
  //   session id: <uuid>
  const m = line.match(/session id:\s*([0-9a-f-]{16,})/i);
  return m?.[1] ?? null;
}

function buildPrompt() {
  // Keep it short-ish; Codex will do the rest.
  return [
    'Create a single-file HTML game in this directory: `index.html`.',
    '',
    'Requirements:',
    '- One file only: HTML + CSS + JS in index.html.',
    '- No external dependencies/CDNs.',
    '- Playable in a browser with keyboard controls.',
    '- Include a start/restart button and a score display.',
    '',
    'After writing the file:',
    '- Print a 1-2 line summary of the game.',
    '- Run: ls -la index.html',
    '- Run: wc -c index.html'
  ].join('\n');
}

async function main() {
  const manager = new PTYManager({ maxOutputSize: 16 * 1024 * 1024 });

  // Run codex in a fresh git repo (Codex CLI expects a git directory).
  const prompt = buildPrompt();
  const bashCommand = [
    'set -euo pipefail',
    'SCRATCH="$(mktemp -d)"',
    'echo "SCRATCH_DIR=$SCRATCH"',
    'cd "$SCRATCH"',
    'git init -q',
    // Use --full-auto to avoid interactive approvals.
    // Use stdin heredoc (single-quoted) to avoid shell command-substitution from backticks in the prompt.
    // Use --json so we can parse Codex's own session id if available.
    "codex exec --full-auto --json - <<'CODEX_PROMPT'",
    prompt,
    'CODEX_PROMPT',
    'echo "CODEX_DONE=1"'
  ].join('\n');

  const sessionId = manager.spawn('bash', { args: ['-lc', bashCommand], cols: 120, rows: 40 });
  console.log('spawned codex sessionId=', sessionId);

  let offset = 0;
  let jsonRemainder = '';
  let textRemainder = '';
  let codexSessionId = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = manager.getStatus(sessionId);
    const chunk = manager.log(sessionId, { offset, limit: 64 * 1024 });
    if (chunk.truncated) {
      console.log('[log] truncated: jumped offset from', offset, 'to', chunk.offset);
    }
    if (chunk.output) {
      process.stdout.write(chunk.output);

      jsonRemainder += chunk.output;
      const lines = jsonRemainder.split(/\r?\n/);
      jsonRemainder = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
        try {
          const obj = JSON.parse(trimmed);
          const found = tryExtractSessionId(obj);
          if (found && !codexSessionId) {
            codexSessionId = found;
            console.log('\n[codex] sessionId=', codexSessionId);
          }
        } catch {
          // ignore
        }
      }

      // Also parse human-readable banner lines (Codex may print those even with --json).
      textRemainder += chunk.output;
      const textLines = textRemainder.split(/\r?\n/);
      textRemainder = textLines.pop() ?? '';
      for (const line of textLines) {
        const found = tryExtractSessionIdFromTextLine(line);
        if (found && !codexSessionId) {
          codexSessionId = found;
          console.log('\n[codex] sessionId=', codexSessionId);
        }
      }
    }
    offset = chunk.nextOffset;

    if (status.status !== 'running') break;
    await sleep(200);
  }

  // Drain any remaining output.
  const tail = manager.log(sessionId, { offset, limit: 1024 * 1024 });
  if (tail.output) process.stdout.write(tail.output);

  const finalStatus = manager.getStatus(sessionId);
  const allOutput = manager.getOutput(sessionId);
  const scratchMatch = allOutput.match(/SCRATCH_DIR=(.+)\r?\n/);
  if (!codexSessionId) {
    const m = allOutput.match(/session id:\s*([0-9a-f-]{16,})/i);
    if (m?.[1]) codexSessionId = m[1];
  }

  console.log('\n--- summary ---');
  console.log('status=', finalStatus.status, 'exitCode=', finalStatus.exitCode);
  console.log('pid=', finalStatus.pid, 'capturedBytes=', finalStatus.outputLength);
  if (scratchMatch) console.log('scratchDir=', scratchMatch[1]);
  if (codexSessionId) console.log('codexSessionId=', codexSessionId);
  console.log('tip: open the generated index.html in your browser (inside scratchDir).');
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
