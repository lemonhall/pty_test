import path from 'node:path';

import type { KillResult, PTYManagerOptions, ReadOutputResult, SessionStatus, SpawnOptions, WriteResult } from './PTYManager.js';
import { PTYManager } from './PTYManager.js';
import { SessionNotFoundError } from './errors.js';

export type ProcessToolDefaults = {
  cleanupMs?: number;
  scopeKey?: string;
  ptyManagerOptions?: Omit<PTYManagerOptions, 'sessionTTL'>;
};

export type ProcessAction = 'list' | 'poll' | 'log' | 'write' | 'send-keys' | 'submit' | 'paste' | 'kill' | 'clear' | 'remove';

export type ProcessRequest = {
  action: ProcessAction;
  sessionId?: string;
  data?: string;
  keys?: string[];
  hex?: string[];
  literal?: string;
  text?: string;
  bracketed?: boolean;
  eof?: boolean;
  offset?: number;
  limit?: number;
};

export type ProcessSessionSummary = {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  pid?: number;
  startedAt: number;
  endedAt?: number;
  runtimeMs: number;
  cwd: string;
  command: string;
  name: string;
  tail: string;
  truncated: boolean;
  exitCode?: number;
  exitSignal?: string;
};

export type ProcessResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

type InternalSessionMeta = {
  id: string;
  scopeKey?: string;
  backgrounded: boolean;
  startedAt: number;
  cwd: string;
  command: string;
  args: string[];
  lastDrainOffset: number;
  exitCode: number | null;
  exitSignal: string | null;
  status: 'running' | 'completed' | 'failed';
  endedAt: number | null;
  cleanupTimer: NodeJS.Timeout | null;
};

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m < 60) return `${m}m${ss.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${mm.toString().padStart(2, '0')}m`;
}

function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const keep = Math.max(0, maxLen - 3);
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return text.slice(0, left) + '...' + text.slice(text.length - right);
}

function deriveSessionName(command: string): string {
  const base = command.trim().split(/\s+/)[0] ?? command;
  return path.basename(base);
}

function sliceLogLines(
  aggregated: string,
  offset?: number,
  limit?: number
): { slice: string; totalLines: number; totalChars: number } {
  const lines = aggregated.split(/\r?\n/);
  const totalLines = lines.length;
  const totalChars = aggregated.length;
  const start = Math.max(0, Math.floor(offset ?? 0));
  const count = Math.max(0, Math.floor(limit ?? 200));
  const slice = lines.slice(start, start + count).join('\n');
  return { slice, totalLines, totalChars };
}

function encodePaste(text: string, bracketed: boolean): string {
  if (!text) return '';
  if (!bracketed) return text;
  return `\x1b[200~${text}\x1b[201~`;
}

function encodeKeySequence(params: { keys?: string[]; hex?: string[]; literal?: string }): { data: string; warnings: string[] } {
  if (params.literal) return { data: params.literal, warnings: [] };

  const warnings: string[] = [];
  const parts: Buffer[] = [];

  if (params.hex?.length) {
    for (const token of params.hex) {
      const cleaned = token.trim().toLowerCase().replace(/^0x/, '');
      const byte = Number.parseInt(cleaned, 16);
      if (Number.isFinite(byte) && byte >= 0 && byte <= 255) {
        parts.push(Buffer.from([byte]));
      } else {
        warnings.push(`Invalid hex byte: ${token}`);
      }
    }
  }

  const map: Record<string, string> = {
    enter: '\r',
    cr: '\r',
    lf: '\n',
    esc: '\x1b',
    tab: '\t',
    backspace: '\x7f',
    'ctrl+c': '\x03',
    'ctrl+d': '\x04',
    'ctrl+z': '\x1a',
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D'
  };

  if (params.keys?.length) {
    for (const key of params.keys) {
      const normalized = key.trim().toLowerCase();
      const encoded = map[normalized];
      if (encoded != null) {
        parts.push(Buffer.from(encoded, 'utf8'));
        continue;
      }
      warnings.push(`Unknown key token: ${key}`);
    }
  }

  return { data: Buffer.concat(parts).toString('utf8'), warnings };
}

export class ProcessManager {
  readonly #pty: PTYManager;
  readonly #cleanupMs: number;
  readonly #scopeKey?: string;
  readonly #sessions = new Map<string, InternalSessionMeta>();

  constructor(defaults?: ProcessToolDefaults) {
    this.#cleanupMs = defaults?.cleanupMs ?? 300_000;
    this.#scopeKey = defaults?.scopeKey;
    this.#pty = new PTYManager({
      ...(defaults?.ptyManagerOptions ?? {}),
      sessionTTL: -1
    });

    this.#pty.on('exit', (sessionId, exitCode) => {
      const meta = this.#sessions.get(sessionId);
      if (!meta) return;
      if (meta.status !== 'running') return;

      meta.exitCode = exitCode;
      meta.endedAt = Date.now();
      meta.status = exitCode === 0 ? 'completed' : 'failed';

      meta.cleanupTimer = setTimeout(() => {
        this.#sessions.delete(sessionId);
        try {
          this.#pty.cleanup(sessionId);
        } catch {
          // ignore
        }
      }, this.#cleanupMs);
      meta.cleanupTimer.unref?.();
    });
  }

  spawn(command: string, options?: SpawnOptions & { backgrounded?: boolean; scopeKey?: string }): string {
    const sessionId = this.#pty.spawn(command, options);
    const cwd = options?.cwd ?? process.cwd();
    const args = options?.args ?? [];
    const backgrounded = options?.backgrounded !== false;
    const scopeKey = options?.scopeKey ?? this.#scopeKey;
    const startedAt = Date.now();

    this.#sessions.set(sessionId, {
      id: sessionId,
      scopeKey,
      backgrounded,
      startedAt,
      cwd,
      command,
      args,
      lastDrainOffset: 0,
      exitCode: null,
      exitSignal: null,
      status: 'running',
      endedAt: null,
      cleanupTimer: null
    });

    return sessionId;
  }

  getStatus(sessionId: string): SessionStatus {
    return this.#pty.getStatus(sessionId);
  }

  process(params: ProcessRequest): ProcessResult {
    if (params.action === 'list') {
      const sessions = this.listSessions();
      const sorted = [...sessions].sort((a: ProcessSessionSummary, b: ProcessSessionSummary) => b.startedAt - a.startedAt);
      const lines = sorted.map((s: ProcessSessionSummary) => {
          const label = s.name ? truncateMiddle(s.name, 80) : truncateMiddle(s.command, 120);
          return `${s.sessionId} ${pad(s.status, 9)} ${formatDuration(s.runtimeMs)} :: ${label}`;
        });
      return {
        content: [{ type: 'text', text: lines.join('\n') || 'No running or recent sessions.' }],
        details: { status: 'completed', sessions }
      };
    }

    if (!params.sessionId) {
      return {
        content: [{ type: 'text', text: 'sessionId is required for this action.' }],
        details: { status: 'failed' }
      };
    }

    const sessionId = params.sessionId;
    const meta = this.#sessions.get(sessionId);
    if (this.#scopeKey && meta?.scopeKey !== this.#scopeKey) {
      return {
        content: [{ type: 'text', text: `No session found for ${sessionId}` }],
        details: { status: 'failed' }
      };
    }

    switch (params.action) {
      case 'poll':
        return this.poll(sessionId);
      case 'log':
        return this.log(sessionId, params.offset, params.limit);
      case 'write':
        return this.write(sessionId, params.data ?? '', params.eof);
      case 'send-keys':
        return this.sendKeys(sessionId, { keys: params.keys, hex: params.hex, literal: params.literal });
      case 'submit':
        return this.submit(sessionId, params.data ?? '');
      case 'paste':
        return this.paste(sessionId, params.text ?? '', params.bracketed !== false);
      case 'kill':
        return this.kill(sessionId);
      case 'clear':
        return this.clear(sessionId);
      case 'remove':
        return this.remove(sessionId);
    }
  }

  listSessions(): ProcessSessionSummary[] {
    const out: ProcessSessionSummary[] = [];
    const now = Date.now();
    for (const meta of this.#sessions.values()) {
      if (this.#scopeKey && meta.scopeKey !== this.#scopeKey) continue;

      const status = meta.status;
      const runtimeMs = (meta.endedAt ?? now) - meta.startedAt;

      let pid: number | undefined;
      let truncated = false;
      let tail = meta.status === 'running' ? '' : meta.status;
      try {
        const st = this.#pty.getStatus(meta.id);
        pid = st.pid;
        const output = this.#pty.getOutput(meta.id);
        const offsets = this.#pty.readOutput(meta.id, { offset: 0, limit: 0 });
        truncated = offsets.startOffset > 0;
        tail = output.slice(-400);
      } catch {
        // ignore: session may have been cleaned up already
      }

      out.push({
        sessionId: meta.id,
        status,
        pid,
        startedAt: meta.startedAt,
        endedAt: meta.endedAt ?? undefined,
        runtimeMs,
        cwd: meta.cwd,
        command: [meta.command, ...meta.args].join(' ').trim(),
        name: deriveSessionName(meta.command),
        tail,
        truncated,
        exitCode: meta.exitCode ?? undefined,
        exitSignal: meta.exitSignal ?? undefined
      });
    }
    return out;
  }

  poll(sessionId: string): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }

    let chunk: ReadOutputResult;
    try {
      chunk = this.#pty.readOutput(sessionId, { offset: meta.lastDrainOffset, limit: 256 * 1024 });
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return {
          content: [{ type: 'text', text: `No session found for ${sessionId}` }],
          details: { status: 'failed' }
        };
      }
      throw err;
    }

    meta.lastDrainOffset = chunk.nextOffset;
    const output = (chunk.data || '').trimEnd();

    const statusObj = this.#pty.getStatus(sessionId);
    const exited = statusObj.status !== 'running';
    const exitCode = statusObj.exitCode ?? 0;

    const status = exited ? (exitCode === 0 ? 'completed' : 'failed') : 'running';
    if (exited) {
      meta.status = status;
      meta.exitCode = exitCode;
      meta.endedAt = meta.endedAt ?? Date.now();
    }

    return {
      content: [
        {
          type: 'text',
          text:
            (output || '(no new output)') +
            (exited ? `\n\nProcess exited with code ${exitCode}.` : '\n\nProcess still running.')
        }
      ],
      details: {
        status,
        sessionId,
        exitCode: exited ? exitCode : undefined,
        truncated: chunk.truncated
      }
    };
  }

  log(sessionId: string, offset?: number, limit?: number): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }

    let aggregated = '';
    let truncated = false;
    try {
      aggregated = this.#pty.getOutput(sessionId);
      const offsets = this.#pty.readOutput(sessionId, { offset: 0, limit: 0 });
      truncated = offsets.startOffset > 0;
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return {
          content: [{ type: 'text', text: `No session found for ${sessionId}` }],
          details: { status: 'failed' }
        };
      }
      throw err;
    }

    const { slice, totalLines, totalChars } = sliceLogLines(aggregated, offset, limit);
    const status = meta.status;

    return {
      content: [{ type: 'text', text: slice || '(no output yet)' }],
      details: {
        status,
        sessionId,
        total: totalLines,
        totalLines,
        totalChars,
        truncated
      }
    };
  }

  write(sessionId: string, data: string, _eof?: boolean): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }
    let result: WriteResult;
    try {
      result = this.#pty.write(sessionId, data);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return {
          content: [{ type: 'text', text: `No active session found for ${sessionId}` }],
          details: { status: 'failed' }
        };
      }
      throw err;
    }
    if (!result.success) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} stdin is not writable.` }],
        details: { status: 'failed' }
      };
    }
    return {
      content: [{ type: 'text', text: `Wrote ${Buffer.byteLength(data, 'utf8')} bytes to session ${sessionId}.` }],
      details: { status: 'running', sessionId }
    };
  }

  sendKeys(sessionId: string, params: { keys?: string[]; hex?: string[]; literal?: string }): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }
    const { data, warnings } = encodeKeySequence(params);
    if (!data) {
      return {
        content: [{ type: 'text', text: 'No key data provided.' }],
        details: { status: 'failed' }
      };
    }
    const result = this.#pty.write(sessionId, data);
    if (!result.success) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} stdin is not writable.` }],
        details: { status: 'failed' }
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Sent ${Buffer.byteLength(data, 'utf8')} bytes to session ${sessionId}.` + (warnings.length ? `\nWarnings:\n- ${warnings.join('\n- ')}` : '')
        }
      ],
      details: { status: 'running', sessionId }
    };
  }

  submit(sessionId: string, data: string): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }
    const payload = data ? data + '\r' : '\r';
    const result = this.#pty.write(sessionId, payload);
    if (!result.success) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} stdin is not writable.` }],
        details: { status: 'failed' }
      };
    }
    return {
      content: [{ type: 'text', text: `Submitted session ${sessionId} (sent CR).` }],
      details: { status: 'running', sessionId }
    };
  }

  paste(sessionId: string, text: string, bracketed: boolean): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }
    const payload = encodePaste(text, bracketed);
    if (!payload) {
      return {
        content: [{ type: 'text', text: 'No paste text provided.' }],
        details: { status: 'failed' }
      };
    }
    const result = this.#pty.write(sessionId, payload);
    if (!result.success) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} stdin is not writable.` }],
        details: { status: 'failed' }
      };
    }
    return {
      content: [{ type: 'text', text: `Pasted ${text.length} chars to session ${sessionId}.` }],
      details: { status: 'running', sessionId }
    };
  }

  kill(sessionId: string): ProcessResult {
    const meta = this.#require(sessionId);
    if (!meta.backgrounded) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not backgrounded.` }],
        details: { status: 'failed' }
      };
    }
    let result: KillResult;
    try {
      result = this.#pty.kill(sessionId, 'SIGKILL');
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        return {
          content: [{ type: 'text', text: `No active session found for ${sessionId}` }],
          details: { status: 'failed' }
        };
      }
      throw err;
    }
    if (!result.success) {
      return {
        content: [{ type: 'text', text: `Failed to kill session ${sessionId}.` }],
        details: { status: 'failed' }
      };
    }
    meta.status = 'failed';
    meta.exitSignal = 'SIGKILL';
    meta.endedAt = meta.endedAt ?? Date.now();
    return {
      content: [{ type: 'text', text: `Killed session ${sessionId}.` }],
      details: { status: 'failed', sessionId }
    };
  }

  clear(sessionId: string): ProcessResult {
    const meta = this.#sessions.get(sessionId);
    if (!meta || meta.status === 'running') {
      return {
        content: [{ type: 'text', text: `No finished session found for ${sessionId}` }],
        details: { status: 'failed' }
      };
    }
    if (meta.cleanupTimer) clearTimeout(meta.cleanupTimer);
    this.#sessions.delete(sessionId);
    try {
      this.#pty.cleanup(sessionId);
    } catch {
      // ignore
    }
    return {
      content: [{ type: 'text', text: `Cleared session ${sessionId}.` }],
      details: { status: 'completed' }
    };
  }

  remove(sessionId: string): ProcessResult {
    const meta = this.#sessions.get(sessionId);
    if (!meta) {
      return {
        content: [{ type: 'text', text: `No session found for ${sessionId}` }],
        details: { status: 'failed' }
      };
    }
    if (meta.status === 'running') {
      this.kill(sessionId);
      if (meta.cleanupTimer) clearTimeout(meta.cleanupTimer);
      this.#sessions.delete(sessionId);
      try {
        this.#pty.cleanup(sessionId);
      } catch {
        // ignore
      }
      return {
        content: [{ type: 'text', text: `Removed session ${sessionId}.` }],
        details: { status: 'failed' }
      };
    }
    return this.clear(sessionId);
  }

  #require(sessionId: string): InternalSessionMeta {
    const meta = this.#sessions.get(sessionId);
    if (!meta) throw new SessionNotFoundError(sessionId);
    return meta;
  }
}
