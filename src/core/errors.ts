/**
 * Typed RFC 9457 error hierarchy mirroring the /v1 problem-code registry
 * (packages/api/src/public/problems.ts). The `code` string is the FINITE
 * stable switch value — `title`/`detail` are for humans and must never be
 * parsed. Unknown codes stay forward-compatible: the class falls back to the
 * HTTP status family and `code` is preserved verbatim.
 */

export interface ProblemFieldError {
  /** JSON Pointer to the offending field, e.g. "/scheduled_at". */
  pointer: string;
  code: string;
  message: string;
}

/** Raw application/problem+json document as received. */
export interface ProblemDocument {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  request_id?: string;
  errors?: ProblemFieldError[];
  [key: string]: unknown;
}

export class BioFlowError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
  }
}

/** The caller's own AbortSignal fired — never retried. */
export class APIUserAbortError extends BioFlowError {}

/** The request never produced an HTTP response (DNS, TLS, socket, …). */
export class APIConnectionError extends BioFlowError {}

/** The per-request timeout elapsed before a response arrived. */
export class APITimeoutError extends APIConnectionError {}

/** Webhook signature verification failed — treat the payload as untrusted. */
export class WebhookVerificationError extends BioFlowError {}

export interface APIErrorProps {
  status: number;
  code: string;
  message: string;
  problemType?: string | undefined;
  title?: string | undefined;
  detail?: string | undefined;
  requestId?: string | undefined;
  errors?: ProblemFieldError[] | undefined;
  retryAfterMs?: number | undefined;
  problem?: ProblemDocument | undefined;
}

export class APIError extends BioFlowError {
  readonly status: number;
  /** Stable machine code from the problem registry, or "unknown". */
  readonly code: string;
  /** The problem `type` URI — resolves to a docs page. */
  readonly problemType: string | undefined;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  /** X-Request-Id — quote it in support requests. */
  readonly requestId: string | undefined;
  /** Per-field validation errors (JSON-Pointer addressed). */
  readonly errors: ProblemFieldError[] | undefined;
  /** Parsed Retry-After, when the server sent one. */
  readonly retryAfterMs: number | undefined;
  /** The raw problem document. */
  readonly problem: ProblemDocument | undefined;

  constructor(props: APIErrorProps) {
    super(props.message);
    this.status = props.status;
    this.code = props.code;
    this.problemType = props.problemType;
    this.title = props.title;
    this.detail = props.detail;
    this.requestId = props.requestId;
    this.errors = props.errors;
    this.retryAfterMs = props.retryAfterMs;
    this.problem = props.problem;
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class RateLimitError extends APIError {}
/**
 * Monthly plan quota consumed (429 `quota_exhausted`). Subclasses
 * RateLimitError so broad catches still work, but the SDK NEVER auto-retries
 * it — Retry-After points at the period reset, not a burst window.
 */
export class QuotaExhaustedError extends RateLimitError {}
export class InternalServerError extends APIError {}

type APIErrorClass = new (props: APIErrorProps) => APIError;

/**
 * problem `code` → error class. One entry per registry code — pinned against
 * PUBLIC_API_PROBLEMS by the packages/api contract suite (drift = red CI).
 */
export const PROBLEM_CODE_ERROR_CLASSES: Record<string, APIErrorClass> = {
  invalid_request: BadRequestError,
  invalid_api_key: AuthenticationError,
  insufficient_scope: PermissionDeniedError,
  feature_not_enabled: PermissionDeniedError,
  test_key_read_only: PermissionDeniedError,
  resource_not_found: NotFoundError,
  stale_snapshot: ConflictError,
  idempotency_in_progress: ConflictError,
  idempotency_key_reused: UnprocessableEntityError,
  endpoint_verification_failed: UnprocessableEntityError,
  endpoint_limit_reached: UnprocessableEntityError,
  rate_limited: RateLimitError,
  quota_exhausted: QuotaExhaustedError,
  internal_error: InternalServerError,
};

function classForStatus(status: number): APIErrorClass {
  if (status === 400) return BadRequestError;
  if (status === 401) return AuthenticationError;
  if (status === 403) return PermissionDeniedError;
  if (status === 404) return NotFoundError;
  if (status === 409) return ConflictError;
  if (status === 422) return UnprocessableEntityError;
  if (status === 429) return RateLimitError;
  if (status >= 500) return InternalServerError;
  return APIError;
}

export function parseRetryAfterMs(
  headerValue: string | null,
): number | undefined {
  if (headerValue === null || headerValue === "") return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(seconds * 1000, 0);
  const dateMs = Date.parse(headerValue) - Date.now();
  return Number.isFinite(dateMs) ? Math.max(dateMs, 0) : undefined;
}

export function apiErrorFromResponse(input: {
  status: number;
  body: unknown;
  requestId: string | undefined;
  retryAfterMs: number | undefined;
}): APIError {
  const problem =
    typeof input.body === "object" && input.body !== null
      ? (input.body as ProblemDocument)
      : undefined;
  const code = typeof problem?.code === "string" ? problem.code : "unknown";
  const title = typeof problem?.title === "string" ? problem.title : undefined;
  const detail =
    typeof problem?.detail === "string" ? problem.detail : undefined;
  const errors = Array.isArray(problem?.errors) ? problem.errors : undefined;
  const requestId =
    input.requestId ??
    (typeof problem?.request_id === "string" ? problem.request_id : undefined);
  const ErrorClass =
    PROBLEM_CODE_ERROR_CLASSES[code] ?? classForStatus(input.status);
  return new ErrorClass({
    status: input.status,
    code,
    message: `${input.status} ${code}: ${detail ?? title ?? "request failed"}`,
    problemType: typeof problem?.type === "string" ? problem.type : undefined,
    title,
    detail,
    requestId,
    errors,
    retryAfterMs: input.retryAfterMs,
    problem,
  });
}
