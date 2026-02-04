import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import * as pty from 'node-pty';

import { SessionNotFoundError, SpawnError } from './errors.js';

export type SessionLifecycleStatus = 'running' | 'exited' | 'killed';

export interface PTYManagerOptions {
  maxOutputSize?: number; // bytes
  sessionTTL?: number; // ms
  defaultCols?: number;
  defaultRows?: number;
  ptyProvider?: PTYProvider;
}

export interface SpawnOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface SessionStatus {
  sessionId: string;
  status: SessionLifecycleStatus;
  exitCode: number | null;
  pid: number;
  startTime: Date;
  endTime: Date | null;
  command: string;
  args: string[];
  cwd: string;
  outputLength: number; // bytes
}

export interface WriteResult {
  success: boolean;
  error?: string;
}

export interface KillResult {
  success: boolean;
  error?: string;
}

export interface ReadOutputResult {
  offset: number;
  nextOffset: number;
  data: string;
  truncated: boolean;
  startOffset: number;
  endOffset: number;
}

export interface ProcessLogResult {
  offset: number;
  nextOffset: number;
  output: string;
  truncated: boolean;
  startOffset: number;
  endOffset: number;
}

export type PTYExitEvent = { exitCode: number; signal?: number };

export interface PTYLike {
  pid: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: PTYExitEvent) => void): void;
  write?(data: string): void;
  resize?(cols: number, rows: number): void;
  kill?(signal?: string): void;
}

export interface PTYProvider {
  spawn(command: string, args: string[], options: { cwd: string; env: Record<string, string>; cols: number; rows: number }): PTYLike;
}

const defaultPtyProvider: PTYProvider = {
  spawn(command, args, options) {
    return pty.spawn(command, args, { ...options, name: 'xterm-256color' });
  }
};

function isUtf8ContinuationByte(b: number): boolean {
  return (b & 0xc0) === 0x80;
}

function utf8ExpectedLength(firstByte: number): number {
  if ((firstByte & 0x80) === 0) return 1;
  if ((firstByte & 0xe0) === 0xc0) return 2;
  if ((firstByte & 0xf0) === 0xe0) return 3;
  if ((firstByte & 0xf8) === 0xf0) return 4;
  return 1;
}

function sanitizeUtf8Slice(buf: Buffer): { buf: Buffer; bytesConsumed: number } {
  if (buf.length === 0) return { buf, bytesConsumed: 0 };

  let start = 0;
  while (start < buf.length && isUtf8ContinuationByte(buf[start]!)) start += 1;

  let end = buf.length;
  if (end - start <= 0) return { buf: Buffer.alloc(0), bytesConsumed: 0 };

  // Ensure the end doesn't cut a multi-byte sequence (best-effort).
  let scan = end - 1;
  while (scan >= start && isUtf8ContinuationByte(buf[scan]!)) scan -= 1;

  if (scan >= start) {
    const expected = utf8ExpectedLength(buf[scan]!);
    const actual = end - scan;
    if (expected > actual) end = scan;
  }

  const safe = buf.subarray(start, end);
  // We advance through:
  // - any leading continuation bytes (dropped to resync), and
  // - the valid UTF-8 bytes we return.
  // We do NOT advance through trailing incomplete sequences (end trimmed).
  return { buf: safe, bytesConsumed: end };
}

class OutputBuffer {
  #maxBytes: number;
  #chunks: Buffer[] = [];
  #bytes = 0; // bytes currently buffered
  #startOffset = 0; // absolute byte offset of the first buffered byte
  #endOffset = 0; // absolute byte offset just after the last written byte

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  append(data: string) {
    if (!data) return;
    const buf = Buffer.from(data, 'utf8');
    this.#chunks.push(buf);
    this.#bytes += buf.length;
    this.#endOffset += buf.length;
    this.#trimToMax();
  }

  get bytes() {
    return this.#bytes;
  }

  get startOffset() {
    return this.#startOffset;
  }

  get endOffset() {
    return this.#endOffset;
  }

  toString(): string {
    return Buffer.concat(this.#chunks, this.#bytes).toString('utf8');
  }

  read(
    offset: number,
    limitBytes: number
  ): {
    offset: number;
    nextOffset: number;
    data: string;
    truncated: boolean;
  } {
    const safeLimit = Math.max(0, limitBytes);
    const requestedOffset = Math.max(0, offset);

    const start = this.#startOffset;
    const end = this.#endOffset;

    const truncated = requestedOffset < start;
    const effectiveOffset = truncated ? start : requestedOffset;

    if (safeLimit === 0 || effectiveOffset >= end) {
      return { offset: effectiveOffset, nextOffset: effectiveOffset, data: '', truncated };
    }

    const relativeStart = effectiveOffset - start;
    const relativeEnd = Math.min(this.#bytes, relativeStart + safeLimit);
    const raw = this.#slice(relativeStart, relativeEnd);
    const { buf: safeBuf, bytesConsumed } = sanitizeUtf8Slice(raw);

    return {
      offset: effectiveOffset,
      nextOffset: effectiveOffset + bytesConsumed,
      data: safeBuf.toString('utf8'),
      truncated
    };
  }

  #slice(relativeStart: number, relativeEnd: number): Buffer {
    if (relativeStart <= 0 && relativeEnd >= this.#bytes) {
      return Buffer.concat(this.#chunks, this.#bytes);
    }

    const out = Buffer.allocUnsafe(Math.max(0, relativeEnd - relativeStart));
    let outPos = 0;
    let cursor = 0;

    for (const chunk of this.#chunks) {
      const chunkStart = cursor;
      const chunkEnd = cursor + chunk.length;
      cursor = chunkEnd;

      if (chunkEnd <= relativeStart) continue;
      if (chunkStart >= relativeEnd) break;

      const startInChunk = Math.max(0, relativeStart - chunkStart);
      const endInChunk = Math.min(chunk.length, relativeEnd - chunkStart);
      const len = endInChunk - startInChunk;
      chunk.copy(out, outPos, startInChunk, endInChunk);
      outPos += len;
    }

    return outPos === out.length ? out : out.subarray(0, outPos);
  }

  #trimToMax() {
    if (this.#bytes <= this.#maxBytes) return;
    let overflow = this.#bytes - this.#maxBytes;

    while (overflow > 0 && this.#chunks.length > 0) {
      const first = this.#chunks[0] ?? Buffer.alloc(0);
      const firstBytes = first.length;
      if (firstBytes <= overflow) {
        this.#chunks.shift();
        this.#bytes -= firstBytes;
        this.#startOffset += firstBytes;
        overflow -= firstBytes;
        continue;
      }

      this.#chunks[0] = first.subarray(overflow);
      this.#bytes -= overflow;
      this.#startOffset += overflow;
      overflow = 0;
    }
  }
}

type SessionRecord = {
  sessionId: string;
  ptyProcess: PTYLike;
  status: SessionLifecycleStatus;
  exitCode: number | null;
  startTime: Date;
  endTime: Date | null;
  command: string;
  args: string[];
  cwd: string;
  output: OutputBuffer;
  killed: boolean;
  cleanupTimer: NodeJS.Timeout | null;
};

export class PTYManager {
  readonly #maxOutputSize: number;
  readonly #sessionTTL: number;
  readonly #defaultCols: number;
  readonly #defaultRows: number;
  readonly #emitter = new EventEmitter();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #ptyProvider: PTYProvider;

  constructor(options?: PTYManagerOptions) {
    this.#maxOutputSize = options?.maxOutputSize ?? 1024 * 1024;
    this.#sessionTTL = options?.sessionTTL ?? 300_000;
    this.#defaultCols = options?.defaultCols ?? 80;
    this.#defaultRows = options?.defaultRows ?? 24;
    this.#ptyProvider = options?.ptyProvider ?? defaultPtyProvider;
  }

  spawn(command: string, options?: SpawnOptions): string {
    const sessionId = randomUUID();
    const args = options?.args ?? [];
    const cwd = options?.cwd ?? process.cwd();

    const cols = Math.max(1, Math.min(500, options?.cols ?? this.#defaultCols));
    const rows = Math.max(1, Math.min(200, options?.rows ?? this.#defaultRows));

    const baseEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') baseEnv[key] = value;
    }
    const env = { ...baseEnv, ...(options?.env ?? {}) };

    let ptyProcess: PTYLike;
    try {
      ptyProcess = this.#ptyProvider.spawn(command, args, { cols, rows, cwd, env });
    } catch (err) {
      throw new SpawnError(command, err);
    }

    const session: SessionRecord = {
      sessionId,
      ptyProcess,
      status: 'running',
      exitCode: null,
      startTime: new Date(),
      endTime: null,
      command,
      args,
      cwd,
      output: new OutputBuffer(this.#maxOutputSize),
      killed: false,
      cleanupTimer: null
    };

    ptyProcess.onData((data) => {
      session.output.append(data);
      this.#emitter.emit('output', sessionId, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.exitCode = typeof exitCode === 'number' ? exitCode : null;
      session.endTime = new Date();
      session.status = session.killed ? 'killed' : 'exited';
      this.#emitter.emit('exit', sessionId, session.exitCode ?? -1);

      if (this.#sessionTTL >= 0) {
        session.cleanupTimer = setTimeout(() => {
          this.#sessions.delete(sessionId);
        }, this.#sessionTTL);
        session.cleanupTimer.unref?.();
      }
    });

    this.#sessions.set(sessionId, session);
    return sessionId;
  }

  getOutput(sessionId: string): string {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    return session.output.toString();
  }

  /**
   * Incremental output reader (aligns with "log offset/limit" semantics).
   *
   * - `offset` is an absolute byte offset into the session's output stream (starts at 0).
   * - `limit` caps how many bytes are returned (default 64KB).
   *
   * If the internal ring buffer has already dropped older bytes, `truncated` will be true and
   * `offset` will be advanced to the earliest available byte.
   */
  readOutput(sessionId: string, options?: { offset?: number; limit?: number }): ReadOutputResult {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 64 * 1024;
    const read = session.output.read(offset, limit);
    return {
      ...read,
      startOffset: session.output.startOffset,
      endOffset: session.output.endOffset
    };
  }

  /**
   * Convenience wrapper to match "process log" shape (offset/limit).
   * Equivalent to `readOutput`, but returns `output` instead of `data`.
   */
  log(sessionId: string, options?: { offset?: number; limit?: number }): ProcessLogResult {
    const chunk = this.readOutput(sessionId, options);
    return {
      offset: chunk.offset,
      nextOffset: chunk.nextOffset,
      output: chunk.data,
      truncated: chunk.truncated,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset
    };
  }

  getStatus(sessionId: string): SessionStatus {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    return {
      sessionId: session.sessionId,
      status: session.status,
      exitCode: session.exitCode,
      pid: session.ptyProcess.pid,
      startTime: session.startTime,
      endTime: session.endTime,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      outputLength: session.output.bytes
    };
  }

  write(sessionId: string, text: string): WriteResult {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (session.status !== 'running') return { success: false, error: 'SESSION_NOT_RUNNING' };
    if (!session.ptyProcess.write) return { success: false, error: 'PTY_NOT_WRITABLE' };

    session.ptyProcess.write(text);
    return { success: true };
  }

  kill(sessionId: string, signal: 'SIGTERM' | 'SIGKILL' | 'SIGINT' = 'SIGTERM'): KillResult {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (session.status !== 'running') return { success: false, error: 'SESSION_NOT_RUNNING' };
    if (!session.ptyProcess.kill) return { success: false, error: 'PTY_NOT_KILLABLE' };

    session.killed = true;
    try {
      session.ptyProcess.kill(signal);
      return { success: true };
    } catch {
      return { success: false, error: 'KILL_FAILED' };
    }
  }

  listSessions(): SessionStatus[] {
    return [...this.#sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      exitCode: s.exitCode,
      pid: s.ptyProcess.pid,
      startTime: s.startTime,
      endTime: s.endTime,
      command: s.command,
      args: s.args,
      cwd: s.cwd,
      outputLength: s.output.bytes
    }));
  }

  cleanup(sessionId?: string): string[] {
    if (sessionId) {
      const session = this.#sessions.get(sessionId);
      if (!session) throw new SessionNotFoundError(sessionId);
      if (session.status === 'running') return [];
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      this.#sessions.delete(sessionId);
      return [sessionId];
    }

    const removed: string[] = [];
    for (const [id, session] of this.#sessions.entries()) {
      if (session.status === 'running') continue;
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      this.#sessions.delete(id);
      removed.push(id);
    }
    return removed;
  }

  destroy(): void {
    for (const session of this.#sessions.values()) {
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      if (session.status !== 'running') continue;
      if (!session.ptyProcess.kill) continue;

      session.killed = true;
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    this.#sessions.clear();
    this.#emitter.removeAllListeners();
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    if (!session.ptyProcess.resize) return;

    const nextCols = Math.max(1, Math.min(500, cols));
    const nextRows = Math.max(1, Math.min(200, rows));
    session.ptyProcess.resize(nextCols, nextRows);
  }

  on(event: 'output', listener: (sessionId: string, data: string) => void): this;
  on(event: 'exit', listener: (sessionId: string, exitCode: number) => void): this;
  on(event: 'output' | 'exit', listener: (...args: any[]) => void): this {
    // typed overloads above
    this.#emitter.on(event, listener);
    return this;
  }
}
