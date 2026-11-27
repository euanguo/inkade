import type { InkadeErrorCode } from "@inkade/core";

export class InkadeApiError extends Error {
  readonly status: number;
  readonly code: InkadeErrorCode | (string & {});
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: InkadeErrorCode | (string & {}),
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InkadeApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isInkadeApiError(error: unknown): error is InkadeApiError {
  return error instanceof InkadeApiError;
}
