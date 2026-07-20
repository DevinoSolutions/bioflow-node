/**
 * The SDK's operation registry — one entry per OpenAPI operation, keyed by
 * operationId. Pinned 1:1 against packages/api/openapi/v1.json by
 * sdk-contracts.test.ts (missing/extra/mismatched entries = red CI), so the
 * client surface can never silently drift from the spec.
 *
 * `idempotent: true` marks operations the server runs through its
 * Idempotency-Key ledger (every consequential POST) — the SDK auto-generates
 * a key for those, which is also what makes them safely retryable.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface OperationDef {
  method: HttpMethod;
  /** Path template with {snake_case} tokens exactly as in the spec. */
  path: string;
  idempotent: boolean;
}

export const SDK_OPERATIONS = {
  getAnalyticsSummary: {
    method: "GET",
    path: "/v1/analytics/summary",
    idempotent: false,
  },
  listContacts: { method: "GET", path: "/v1/contacts", idempotent: false },
  listFiles: { method: "GET", path: "/v1/files", idempotent: false },
  listPages: { method: "GET", path: "/v1/pages", idempotent: false },
  createPage: { method: "POST", path: "/v1/pages", idempotent: true },
  deletePage: {
    method: "DELETE",
    path: "/v1/pages/{page_id}",
    idempotent: false,
  },
  getPage: { method: "GET", path: "/v1/pages/{page_id}", idempotent: false },
  updatePage: {
    method: "PATCH",
    path: "/v1/pages/{page_id}",
    idempotent: false,
  },
  addBlock: {
    method: "POST",
    path: "/v1/pages/{page_id}/blocks",
    idempotent: true,
  },
  removeBlock: {
    method: "DELETE",
    path: "/v1/pages/{page_id}/blocks/{block_id}",
    idempotent: false,
  },
  publishPage: {
    method: "POST",
    path: "/v1/pages/{page_id}/publish",
    idempotent: true,
  },
  getUsage: { method: "GET", path: "/v1/usage", idempotent: false },
  listWebhookEndpoints: {
    method: "GET",
    path: "/v1/webhook-endpoints",
    idempotent: false,
  },
  createWebhookEndpoint: {
    method: "POST",
    path: "/v1/webhook-endpoints",
    idempotent: true,
  },
  deleteWebhookEndpoint: {
    method: "DELETE",
    path: "/v1/webhook-endpoints/{endpoint_id}",
    idempotent: false,
  },
  getWebhookEndpoint: {
    method: "GET",
    path: "/v1/webhook-endpoints/{endpoint_id}",
    idempotent: false,
  },
  updateWebhookEndpoint: {
    method: "PATCH",
    path: "/v1/webhook-endpoints/{endpoint_id}",
    idempotent: false,
  },
  listWebhookDeliveries: {
    method: "GET",
    path: "/v1/webhook-endpoints/{endpoint_id}/deliveries",
    idempotent: false,
  },
  resendWebhookDelivery: {
    method: "POST",
    path: "/v1/webhook-endpoints/{endpoint_id}/deliveries/{delivery_id}/resend",
    idempotent: true,
  },
  replayWebhookDeliveries: {
    method: "POST",
    path: "/v1/webhook-endpoints/{endpoint_id}/replay",
    idempotent: true,
  },
  rotateWebhookSecret: {
    method: "POST",
    path: "/v1/webhook-endpoints/{endpoint_id}/rotate-secret",
    idempotent: true,
  },
  testWebhookEndpoint: {
    method: "POST",
    path: "/v1/webhook-endpoints/{endpoint_id}/test",
    idempotent: true,
  },
} as const satisfies Record<string, OperationDef>;

export type OperationId = keyof typeof SDK_OPERATIONS;
