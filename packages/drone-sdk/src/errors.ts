export class DroneSDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DroneSDKError';
  }
}

export class TransportError extends DroneSDKError {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
  }
}

export class TimeoutError extends TransportError {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends DroneSDKError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends TransportError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends TransportError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
