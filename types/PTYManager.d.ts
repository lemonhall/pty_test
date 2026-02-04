export type SessionLifecycleStatus = 'running' | 'exited' | 'killed';
export interface PTYManagerOptions {
    maxOutputSize?: number;
    sessionTTL?: number;
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
    outputLength: number;
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
export type PTYExitEvent = {
    exitCode: number;
    signal?: number;
};
export interface PTYLike {
    pid: number;
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: PTYExitEvent) => void): void;
    write?(data: string): void;
    resize?(cols: number, rows: number): void;
    kill?(signal?: string): void;
}
export interface PTYProvider {
    spawn(command: string, args: string[], options: {
        cwd: string;
        env: Record<string, string>;
        cols: number;
        rows: number;
    }): PTYLike;
}
export declare class PTYManager {
    #private;
    constructor(options?: PTYManagerOptions);
    spawn(command: string, options?: SpawnOptions): string;
    getOutput(sessionId: string): string;
    /**
     * Incremental output reader (aligns with "log offset/limit" semantics).
     *
     * - `offset` is an absolute byte offset into the session's output stream (starts at 0).
     * - `limit` caps how many bytes are returned (default 64KB).
     *
     * If the internal ring buffer has already dropped older bytes, `truncated` will be true and
     * `offset` will be advanced to the earliest available byte.
     */
    readOutput(sessionId: string, options?: {
        offset?: number;
        limit?: number;
    }): ReadOutputResult;
    /**
     * Convenience wrapper to match "process log" shape (offset/limit).
     * Equivalent to `readOutput`, but returns `output` instead of `data`.
     */
    log(sessionId: string, options?: {
        offset?: number;
        limit?: number;
    }): ProcessLogResult;
    getStatus(sessionId: string): SessionStatus;
    write(sessionId: string, text: string): WriteResult;
    kill(sessionId: string, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): KillResult;
    listSessions(): SessionStatus[];
    cleanup(sessionId?: string): string[];
    destroy(): void;
    resize(sessionId: string, cols: number, rows: number): void;
    on(event: 'output', listener: (sessionId: string, data: string) => void): this;
    on(event: 'exit', listener: (sessionId: string, exitCode: number) => void): this;
}
