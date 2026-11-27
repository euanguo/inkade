export type InkadeErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "INVALID_PARENT_CYCLE"
  | "SECTION_NOT_FOUND"
  | "HARD_DELETE_BLOCKED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export const ERROR_HTTP_STATUS: Readonly<Record<InkadeErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_PARENT_CYCLE: 422,
  SECTION_NOT_FOUND: 404,
  HARD_DELETE_BLOCKED: 403,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class InkadeError extends Error {
  readonly code: InkadeErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: InkadeErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InkadeError";
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

export function isInkadeError(error: unknown): error is InkadeError {
  return error instanceof InkadeError;
}
