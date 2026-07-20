/**
 * The HTTP core every resource method rides. Behavior contract (pinned by
 * http-behavior.test.ts):
 *  - auth: `Authorization: Bearer bf_…` by default, or `x-api-key` style
 *  - retries (default 2): 429 `rate_limited` for ANY method (the server
 *    refuses those pre-execution); network/timeout/408/5xx only for GETs and
 *    for POSTs carrying an Idempotency-Key. 429 `quota_exhausted`, PATCH and
 *    DELETE are NEVER auto-retried (unsafe or pointless).
 *  - `Retry-After` is honored exactly (seconds or HTTP-date); waits beyond
 *    maxRetryAfterMs abandon the retry instead of sleeping for minutes.
 *  - every consequential POST gets an auto-generated Idempotency-Key (the
 *    server ledgers all of them) unless the caller supplies one or disables
 *    autoIdempotencyKeys; the SAME key is reused across retries.
 *  - errors: application/problem+json → the typed hierarchy in errors.ts.
 *  - debug logging never emits secrets (redactSecrets + no header/body logs).
 */
import {
  APIConnectionError,
  APITimeoutError,
  APIUserAbortError,
  BioFlowError,
  apiErrorFromResponse,
  parseRetryAfterMs,
} from "./errors";
import { redactSecrets } from "./redact";
import type { HttpMethod } from "../operations";
import { VERSION } from "../version";

export const DEFAULT_BASE_URL = "https://app.getbioflow.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

export interface ClientOptions {
  /** A bf_live_/bf_test_ secret API key. Server-side only. */
  apiKey: string;
  /** Defaults to https://app.getbioflow.com */
  baseUrl?: string;
  /** Per-request timeout. Default 30 000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  maxRetries?: number;
  /** How the key is sent: Authorization Bearer (default) or x-api-key. */
  authStyle?: "bearer" | "x-api-key";
  /** Auto-generate Idempotency-Key on consequential POSTs. Default true. */
  autoIdempotencyKeys?: boolean;
  /** Longest Retry-After the SDK will sleep for. Default 60 000 ms. */
  maxRetryAfterMs?: number;
  /** Extra headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** true → console.warn, or supply a sink. Lines are secret-redacted. */
  debug?: boolean | ((line: string) => void);
  /** Custom fetch (testing, instrumentation). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * bf_ keys are SECRETS — running this SDK in a browser exposes them to
   * every visitor. The constructor throws in browser-like environments
   * unless this is explicitly set.
   */
  dangerouslyAllowBrowser?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  idempotencyKey?: string;
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
}

export interface RawResult<T> {
  data: T;
  response: Response;
  requestId: string | null;
}

export interface RequestInput {
  method: HttpMethod;
  /** Concrete path, tokens already substituted (e.g. /v1/pages/pg_123). */
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
}

function isBrowserLike(): boolean {
  const candidate = (
    globalThis as { window?: { document?: unknown } | undefined }
  ).window;
  return candidate !== undefined && candidate.document !== undefined;
}

function generateIdempotencyKey(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (webCrypto?.randomUUID) return `sdk_${webCrypto.randomUUID()}`;
  let suffix = "";
  for (let i = 0; i < 32; i++) {
    suffix += Math.floor(Math.random() * 16).toString(16);
  }
  return `sdk_${suffix}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });
}

export class HttpCore {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly authStyle: "bearer" | "x-api-key";
  private readonly autoIdempotencyKeys: boolean;
  private readonly maxRetryAfterMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly debug: ClientOptions["debug"];
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new BioFlowError(
        "Missing API key — pass { apiKey: 'bf_live_…' } (create one in BioFlow → Settings).",
      );
    }
    if (isBrowserLike() && options.dangerouslyAllowBrowser !== true) {
      throw new BioFlowError(
        "@getbioflow/sdk was loaded in a browser-like environment. bf_ API keys are secrets and must stay server-side. If you really know what you are doing, pass { dangerouslyAllowBrowser: true }.",
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.authStyle = options.authStyle ?? "bearer";
    this.autoIdempotencyKeys = options.autoIdempotencyKeys ?? true;
    this.maxRetryAfterMs =
      options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.debug = options.debug;
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new BioFlowError(
        "No fetch implementation found — Node >=18.17 (or pass { fetch }).",
      );
    }
    this.fetchFn = fetchFn;
  }

  async request<T>(
    input: RequestInput,
    opts: RequestOptions = {},
  ): Promise<RawResult<T>> {
    const url = this.buildUrl(input.path, input.query);
    const maxRetries = opts.maxRetries ?? this.maxRetries;
    // Resolved ONCE so every retry replays the same key (the server's ledger
    // then dedupes instead of double-executing).
    const idempotencyKey =
      opts.idempotencyKey ??
      (input.method === "POST" && this.autoIdempotencyKeys
        ? generateIdempotencyKey()
        : undefined);
    const headers = this.buildHeaders(input, opts, idempotencyKey);
    const serializedBody =
      input.body === undefined ? undefined : JSON.stringify(input.body);

    for (let attempt = 0; ; attempt++) {
      this.log(
        `${input.method} ${input.path} attempt ${attempt + 1}/${maxRetries + 1}`,
      );
      let response: Response;
      try {
        response = await this.performFetch(url, {
          method: input.method,
          headers,
          body: serializedBody,
          signal: opts.signal,
          timeoutMs: opts.timeoutMs ?? this.timeoutMs,
        });
      } catch (error) {
        if (error instanceof APIUserAbortError) throw error;
        const retryable =
          error instanceof APIConnectionError &&
          this.methodRetryable(input.method, idempotencyKey !== undefined);
        if (!retryable || attempt >= maxRetries) throw error;
        const delay = this.backoffMs(attempt, null);
        this.log(
          `${input.method} ${input.path} connection error — retrying in ${Math.round(delay ?? 0)}ms`,
        );
        await sleep(delay ?? 0);
        continue;
      }

      const requestId = response.headers.get("x-request-id");
      if (response.ok) {
        this.log(
          `${input.method} ${input.path} -> ${response.status} (${requestId ?? "no request id"})`,
        );
        const data = (await this.parseSuccessBody(response)) as T;
        return { data, response, requestId };
      }

      const errorBody = await this.parseErrorBody(response);
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      const apiError = apiErrorFromResponse({
        status: response.status,
        body: errorBody,
        requestId: requestId ?? undefined,
        retryAfterMs,
      });
      this.log(
        `${input.method} ${input.path} -> ${response.status} ${apiError.code} (${requestId ?? "no request id"})`,
      );
      if (
        attempt >= maxRetries ||
        !this.responseRetryable(
          input.method,
          response.status,
          apiError.code,
          idempotencyKey !== undefined,
        )
      ) {
        throw apiError;
      }
      const delay = this.backoffMs(attempt, retryAfterMs ?? null);
      if (delay === null) throw apiError; // Retry-After beyond our budget
      this.log(
        `${input.method} ${input.path} retrying in ${Math.round(delay)}ms`,
      );
      await sleep(delay);
    }
  }

  private buildUrl(
    path: string,
    query: Record<string, unknown> | undefined,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private buildHeaders(
    input: RequestInput,
    opts: RequestOptions,
    idempotencyKey: string | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Bioflow-Client": `getbioflow-sdk/${VERSION}`,
      ...this.defaultHeaders,
      ...opts.headers,
    };
    // Some runtimes (browsers) forbid setting User-Agent — best effort only;
    // X-Bioflow-Client above always carries the SDK identity.
    headers["User-Agent"] ??= `getbioflow-sdk/${VERSION}`;
    if (this.authStyle === "x-api-key") {
      headers["x-api-key"] = this.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (input.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return headers;
  }

  private async performFetch(
    url: string,
    init: {
      method: HttpMethod;
      headers: Record<string, string>;
      body: string | undefined;
      signal: AbortSignal | undefined;
      timeoutMs: number;
    },
  ): Promise<Response> {
    if (init.signal?.aborted) {
      throw new APIUserAbortError("Request aborted by caller");
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, init.timeoutMs);
    (timer as { unref?: () => void }).unref?.();
    const onUserAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onUserAbort, { once: true });
    try {
      return await this.fetchFn(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new APITimeoutError(
          `Request timed out after ${init.timeoutMs}ms`,
          { cause: error },
        );
      }
      if (init.signal?.aborted) {
        throw new APIUserAbortError("Request aborted by caller");
      }
      throw new APIConnectionError(
        redactSecrets(
          `Connection error: ${error instanceof Error ? error.message : String(error)}`,
        ),
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onUserAbort);
    }
  }

  private async parseSuccessBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) return response.json();
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  }

  private async parseErrorBody(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      if (text.length === 0) return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    } catch {
      return undefined;
    }
  }

  /** May this method retry on network/timeout/408/5xx failures? */
  private methodRetryable(
    method: HttpMethod,
    hasIdempotencyKey: boolean,
  ): boolean {
    if (method === "GET") return true;
    if (method === "POST") return hasIdempotencyKey;
    return false; // PATCH/DELETE: ambiguous partial effects — never auto-retry
  }

  private responseRetryable(
    method: HttpMethod,
    status: number,
    code: string,
    hasIdempotencyKey: boolean,
  ): boolean {
    if (status === 429) {
      // rate_limited was refused pre-execution — safe for ANY method.
      // quota_exhausted resets at the period boundary — retrying is wrong.
      return code !== "quota_exhausted";
    }
    if (status === 408 || status >= 500) {
      return this.methodRetryable(method, hasIdempotencyKey);
    }
    return false;
  }

  /** null = the server asked for a longer wait than we will sleep. */
  private backoffMs(
    attempt: number,
    retryAfterMs: number | null,
  ): number | null {
    if (retryAfterMs !== null && retryAfterMs !== undefined) {
      return retryAfterMs > this.maxRetryAfterMs ? null : retryAfterMs;
    }
    const base = Math.min(500 * 2 ** attempt, 8000);
    return base * (0.75 + Math.random() * 0.5);
  }

  private log(line: string): void {
    if (!this.debug) return;
    const sink =
      typeof this.debug === "function"
        ? this.debug
        : (message: string) => console.warn(message);
    sink(redactSecrets(`[bioflow-sdk] ${line}`));
  }
}
