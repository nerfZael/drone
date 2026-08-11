export class ChangeRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code: string | null = null,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ChangeRequestError';
  }
}
