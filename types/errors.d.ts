export declare class PTYError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class SessionNotFoundError extends PTYError {
    readonly sessionId: string;
    constructor(sessionId: string);
}
export declare class SpawnError extends PTYError {
    readonly command: string;
    readonly originalError: unknown;
    constructor(command: string, originalError: unknown);
}
