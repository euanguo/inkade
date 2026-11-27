import { InkadeApiError } from "./errors.ts";

export type FetchCredentials = "omit" | "same-origin" | "include";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface InkadeClientConfig {
  readonly baseUrl: string;
  readonly token?: string | undefined;
  readonly credentials?: FetchCredentials | undefined;
  readonly fetch?: FetchLike | typeof fetch | undefined;
}

export interface InkadeConnectionConfig {
  readonly baseUrl: string;
  readonly token?: string | undefined;
  readonly credentials?: FetchCredentials | undefined;
  readonly fetch: FetchLike;
}

export function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      qs.set(key, String(value));
    }
  }
  const encoded = qs.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * Shared HTTP transport for all `InkadeClient` domain resource clients.
 */
export class InkadeHttpTransport {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly credentials: FetchCredentials | undefined;
  private readonly fetchFn: FetchLike;

  constructor(config: InkadeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.credentials = config.credentials;
    this.fetchFn = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /**
   * Returns a read-only snapshot of the resolved transport configuration for SSE and React bindings.
   */
  getConnectionConfig(): InkadeConnectionConfig {
    return {
      baseUrl: this.baseUrl,
      token: this.token,
      credentials: this.credentials,
      fetch: this.fetchFn,
    };
  }

  async requestRaw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const resolvedCredentials = init.credentials ?? this.credentials;
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      ...(resolvedCredentials !== undefined ? { credentials: resolvedCredentials } : {}),
    });

    if (!response.ok) {
      let code = "HTTP_ERROR";
      let message = `Request failed with status ${response.status}`;
      let details: Record<string, unknown> | undefined;
      try {
        const parsed = (await response.json()) as {
          error?: { code?: string; message?: string; details?: Record<string, unknown> };
          message?: string;
        };
        if (parsed.error) {
          code = parsed.error.code ?? code;
          message = parsed.error.message ?? message;
          details = parsed.error.details;
        } else if (parsed.message) {
          message = parsed.message;
        }
      } catch {
        // leave default message
      }
      throw new InkadeApiError(response.status, code, message, details);
    }

    return response;
  }

  async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await this.requestRaw(path, { ...init, headers });
    return (await response.json()) as T;
  }
}
