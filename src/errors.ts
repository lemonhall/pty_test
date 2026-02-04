export class PTYError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class SessionNotFoundError extends PTYError {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
    this.sessionId = sessionId;
  }
}

export class SpawnError extends PTYError {
  public readonly command: string;
  public readonly originalError: unknown;

  constructor(command: string, originalError: unknown) {
    super(`Failed to spawn PTY process: ${command}`, 'SPAWN_FAILED');
    this.command = command;
    this.originalError = originalError;
  }
}
