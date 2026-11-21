import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
  static internal(message = 'Something went wrong') {
    return new ApiError(500, 'INTERNAL', message);
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export function toErrorBody(err: unknown, requestId?: string): { status: number; body: ApiErrorBody } {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message, details: err.details, requestId } },
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields need attention',
          details: err.flatten(),
          requestId,
        },
      },
    };
  }
  const status = (err as { status?: number })?.status;
  if (status === 413) {
    return {
      status: 413,
      body: { error: { code: 'FILE_TOO_LARGE', message: 'Upload exceeds the 5 MB limit', requestId } },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: 'Something went wrong', requestId } },
  };
}
