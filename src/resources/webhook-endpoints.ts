import type { HttpCore, RequestOptions } from "../core/http";
import { fetchCursorPage, type CursorPage } from "../core/pagination";
import { SDK_OPERATIONS } from "../operations";
import type {
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  QueryOf,
  ReplayWebhooksRequest,
  RotateWebhookSecretResponse,
  UpdateWebhookEndpointRequest,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointList,
  WebhookReplayResult,
  WebhookTestResult,
} from "../types";

export class WebhookEndpoints {
  constructor(private readonly core: HttpCore) {}

  /** GET /v1/webhook-endpoints (bounded collection — no cursor). */
  async list(opts?: RequestOptions): Promise<WebhookEndpointList> {
    const { data } = await this.core.request<WebhookEndpointList>(
      { method: "GET", path: SDK_OPERATIONS.listWebhookEndpoints.path },
      opts,
    );
    return data;
  }

  /**
   * POST /v1/webhook-endpoints — the URL is SSRF-checked and must answer the
   * signed endpoint.test event with a 2xx before the endpoint is created.
   * The returned `secret` (whsec_…) is shown ONCE — store it now.
   */
  async create(
    body: CreateWebhookEndpointRequest,
    opts?: RequestOptions,
  ): Promise<CreateWebhookEndpointResponse> {
    const { data } = await this.core.request<CreateWebhookEndpointResponse>(
      { method: "POST", path: SDK_OPERATIONS.createWebhookEndpoint.path, body },
      opts,
    );
    return data;
  }

  /** GET /v1/webhook-endpoints/{endpoint_id} */
  async get(
    endpointId: string,
    opts?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    const { data } = await this.core.request<WebhookEndpoint>(
      {
        method: "GET",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
      },
      opts,
    );
    return data;
  }

  /** PATCH /v1/webhook-endpoints/{endpoint_id} — URL changes re-verify. */
  async update(
    endpointId: string,
    body: UpdateWebhookEndpointRequest,
    opts?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    const { data } = await this.core.request<WebhookEndpoint>(
      {
        method: "PATCH",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
        body,
      },
      opts,
    );
    return data;
  }

  /** DELETE /v1/webhook-endpoints/{endpoint_id} */
  async delete(endpointId: string, opts?: RequestOptions): Promise<void> {
    await this.core.request<undefined>(
      {
        method: "DELETE",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
      },
      opts,
    );
  }

  /**
   * POST /v1/webhook-endpoints/{endpoint_id}/rotate-secret — returns the NEW
   * secret (shown once); the previous secret keeps signing until
   * `previous_secret_expires_at` (24h dual-signature overlap).
   */
  async rotateSecret(
    endpointId: string,
    opts?: RequestOptions,
  ): Promise<RotateWebhookSecretResponse> {
    const { data } = await this.core.request<RotateWebhookSecretResponse>(
      {
        method: "POST",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/rotate-secret`,
      },
      opts,
    );
    return data;
  }

  /** POST /v1/webhook-endpoints/{endpoint_id}/test — sends endpoint.test. */
  async test(
    endpointId: string,
    opts?: RequestOptions,
  ): Promise<WebhookTestResult> {
    const { data } = await this.core.request<WebhookTestResult>(
      {
        method: "POST",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/test`,
      },
      opts,
    );
    return data;
  }

  /** GET /v1/webhook-endpoints/{endpoint_id}/deliveries — cursor-paginated. */
  deliveries(
    endpointId: string,
    params: Omit<QueryOf<"listWebhookDeliveries">, never> = {},
    opts?: RequestOptions,
  ): Promise<CursorPage<WebhookDelivery>> {
    return fetchCursorPage<WebhookDelivery>(this.core, {
      path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries`,
      query: params,
      opts,
    });
  }

  /**
   * POST …/deliveries/{delivery_id}/resend — re-delivers with the SAME
   * webhook-id (your consumer's dedup key still applies).
   */
  async resendDelivery(
    endpointId: string,
    deliveryId: string,
    opts?: RequestOptions,
  ): Promise<WebhookDelivery> {
    const { data } = await this.core.request<WebhookDelivery>(
      {
        method: "POST",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries/${encodeURIComponent(deliveryId)}/resend`,
      },
      opts,
    );
    return data;
  }

  /** POST …/replay — re-queues every FAILED delivery since a timestamp. */
  async replay(
    endpointId: string,
    body: ReplayWebhooksRequest,
    opts?: RequestOptions,
  ): Promise<WebhookReplayResult> {
    const { data } = await this.core.request<WebhookReplayResult>(
      {
        method: "POST",
        path: `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/replay`,
        body,
      },
      opts,
    );
    return data;
  }
}
