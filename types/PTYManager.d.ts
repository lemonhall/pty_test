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
    getStatus(sessionId: string): SessionStatus;
    write(sessionId: string, text: string): WriteResult;
    kill(sessionId: string, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): KillResult;
    on(event: 'output', listener: (sessionId: string, data: string) => void): this;
    on(event: 'exit', listener: (sessionId: string, exitCode: number) => void): this;
}
