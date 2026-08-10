export type HubDomainErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'container_unavailable'
  | 'repository_conflict'
  | 'internal_error';

export class HubDomainError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: HubDomainErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidRequestError extends HubDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'invalid_request', details);
  }
}

export class ResourceNotFoundError extends HubDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 404, 'not_found', details);
  }
}

export class DomainConflictError extends HubDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'conflict', details);
  }
}

export class ContainerUnavailableError extends HubDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 503, 'container_unavailable', details);
  }
}

export class RepositoryConflictError extends HubDomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'repository_conflict', details);
  }
}

export interface HubHttpErrorDescriptor {
  statusCode: number;
  body: Record<string, unknown>;
}

export function describeHubError(error: unknown, fallbackStatus = 500): HubHttpErrorDescriptor {
  if (error instanceof HubDomainError) {
    return {
      statusCode: error.statusCode,
      body: {
        ok: false,
        error: error.message,
        code: error.code,
        ...(error.details ?? {}),
      },
    };
  }

  const candidate = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  } | null;
  const upstreamStatus = /^HUB_(\d{3})$/.exec(String(candidate?.code ?? ''))?.[1];
  const explicitStatus = Number(candidate?.statusCode ?? candidate?.status ?? upstreamStatus ?? 0);
  const statusCode =
    Number.isFinite(explicitStatus) && explicitStatus >= 400
      ? Math.floor(explicitStatus)
      : fallbackStatus;
  const message = String(candidate?.message ?? error ?? 'unknown error');
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
  return {
    statusCode,
    body: { ok: false, error: message, ...(code ? { code } : {}) },
  };
}
