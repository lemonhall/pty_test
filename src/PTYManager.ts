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

function byteLengthUtf8(data: string): number {
  return Buffer.byteLength(data, 'utf8');
}

function trimStartByBytesUtf8(data: string, bytesToTrim: number): string {
  const buf = Buffer.from(data, 'utf8');
  if (bytesToTrim >= buf.length) return '';
  return buf.subarray(bytesToTrim).toString('utf8');
}

class OutputBuffer {
  #maxBytes: number;
  #chunks: string[] = [];
  #bytes = 0;
  #cache: string | null = '';

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  append(data: string) {
    if (!data) return;
    this.#chunks.push(data);
    this.#bytes += byteLengthUtf8(data);
    this.#cache = null;
    this.#trimToMax();
  }

  get bytes() {
    return this.#bytes;
  }

  toString(): string {
    if (this.#cache === null) this.#cache = this.#chunks.join('');
    return this.#cache;
  }

  #trimToMax() {
    if (this.#bytes <= this.#maxBytes) return;
    let overflow = this.#bytes - this.#maxBytes;

    while (overflow > 0 && this.#chunks.length > 0) {
      const first = this.#chunks[0] ?? '';
      const firstBytes = byteLengthUtf8(first);
      if (firstBytes <= overflow) {
        this.#chunks.shift();
        this.#bytes -= firstBytes;
        overflow -= firstBytes;
        continue;
      }

      const trimmed = trimStartByBytesUtf8(first, overflow);
      const trimmedBytes = byteLengthUtf8(trimmed);
      this.#chunks[0] = trimmed;
      this.#bytes -= firstBytes - trimmedBytes;
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
