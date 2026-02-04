import type { PTYManagerOptions, SessionStatus, SpawnOptions } from './PTYManager.js';
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
    content: Array<{
        type: 'text';
        text: string;
    }>;
    details: Record<string, unknown>;
};
export declare class ProcessManager {
    #private;
    constructor(defaults?: ProcessToolDefaults);
    spawn(command: string, options?: SpawnOptions & {
        backgrounded?: boolean;
        scopeKey?: string;
    }): string;
    getStatus(sessionId: string): SessionStatus;
    process(params: ProcessRequest): ProcessResult;
    listSessions(): ProcessSessionSummary[];
    poll(sessionId: string): ProcessResult;
    log(sessionId: string, offset?: number, limit?: number): ProcessResult;
    write(sessionId: string, data: string, _eof?: boolean): ProcessResult;
    sendKeys(sessionId: string, params: {
        keys?: string[];
        hex?: string[];
        literal?: string;
    }): ProcessResult;
    submit(sessionId: string, data: string): ProcessResult;
    paste(sessionId: string, text: string, bracketed: boolean): ProcessResult;
    kill(sessionId: string): ProcessResult;
    clear(sessionId: string): ProcessResult;
    remove(sessionId: string): ProcessResult;
}
