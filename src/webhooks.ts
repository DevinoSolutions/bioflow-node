/**
 * Standard Webhooks v1 signature verification — the consumer-side mirror of
 * packages/api/src/webhooks/signing.ts (pinned equal by the packages/api
 * contract suite): HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` with the
 * base64-decoded whsec_ secret, headers webhook-id / webhook-timestamp /
 * webhook-signature, space-separated `v1,<base64>` entries (rotation sends
 * two), 300s timestamp tolerance, constant-time compare, and verification
 * over the RAW bytes — verify FIRST, JSON.parse after.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookVerificationError } from "./core/errors";

export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

interface WebhookEventBase {
  /** whmsg_… — STABLE across retries; use it as your dedup key. */
  id: string;
  created_at: string;
}

export interface ContactCreatedEvent extends WebhookEventBase {
  type: "contact.created";
  data: {
    contact: {
      id: string;
      email: string;
      name: string | null;
      source: string;
      source_block_id: string | null;
      created_at: string;
    };
  };
}

export interface PagePublishedEvent extends WebhookEventBase {
  type: "page.published";
  data: {
    page: { id: string; title: string; slug: string; published_at: string };
  };
}

interface SaleEventData {
  sale: {
    id: string;
    kind: string;
    gross_amount_cents: number;
    net_amount_cents: number;
    currency: string;
    customer_email: string | null;
    created_at: string;
  };
}

export interface SalePaidEvent extends WebhookEventBase {
  type: "sale.paid";
  data: SaleEventData;
}

export interface SaleRefundedEvent extends WebhookEventBase {
  type: "sale.refunded";
  data: SaleEventData;
}

/** Sent at endpoint creation/URL change and POST …/test. */
export interface EndpointTestEvent extends WebhookEventBase {
  type: "endpoint.test";
  data: { message: string };
}

/**
 * Forward compatibility: new event types may ship WITHOUT a major SDK bump,
 * so at runtime `type` can hold values outside the union below — the verifier
 * never rejects them. Always give your `switch (event.type)` a default branch
 * and treat that payload as UnknownWebhookEvent.
 */
export interface UnknownWebhookEvent extends WebhookEventBase {
  type: string;
  data: unknown;
}

export type WebhookEvent =
  | ContactCreatedEvent
  | PagePublishedEvent
  | SalePaidEvent
  | SaleRefundedEvent
  | EndpointTestEvent;

export interface VerifyWebhookInput {
  /** The RAW request body — bytes or the exact string, never re-serialized. */
  payload: string | Uint8Array;
  /** The delivery's HTTP headers (Headers, or a plain header record). */
  headers: Headers | Record<string, string | string[] | undefined>;
  /** The endpoint's whsec_ signing secret. */
  secret: string;
  toleranceSeconds?: number;
  /** Override "now" (tests). */
  now?: Date;
}

function headerValue(
  headers: VerifyWebhookInput["headers"],
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === name,
  );
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

function secretBytes(secret: string): Buffer {
  const raw = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  return Buffer.from(raw, "base64");
}

/**
 * Verifies a delivery and returns the parsed, typed event. Throws
 * WebhookVerificationError on ANY failure — treat such payloads as untrusted.
 */
export function verifyWebhook(input: VerifyWebhookInput): WebhookEvent {
  const id = headerValue(input.headers, WEBHOOK_ID_HEADER);
  const timestampHeader = headerValue(input.headers, WEBHOOK_TIMESTAMP_HEADER);
  const signatureHeader = headerValue(input.headers, WEBHOOK_SIGNATURE_HEADER);
  if (id === undefined || id.length === 0) {
    throw new WebhookVerificationError("Missing webhook-id header");
  }
  if (timestampHeader === undefined) {
    throw new WebhookVerificationError("Missing webhook-timestamp header");
  }
  if (signatureHeader === undefined) {
    throw new WebhookVerificationError("Missing webhook-signature header");
  }
  const timestampSeconds = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestampSeconds)) {
    throw new WebhookVerificationError("Malformed webhook-timestamp header");
  }
  const tolerance =
    input.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    throw new WebhookVerificationError(
      "webhook-timestamp outside tolerance — replayed or badly delayed delivery",
    );
  }

  const hmac = createHmac("sha256", secretBytes(input.secret));
  hmac.update(`${id}.${timestampSeconds}.`, "utf8");
  if (typeof input.payload === "string") {
    hmac.update(input.payload, "utf8");
  } else {
    hmac.update(input.payload);
  }
  const expected = Buffer.from(hmac.digest("base64"), "base64");

  let matched = false;
  for (const candidate of signatureHeader.split(" ")) {
    if (!candidate.startsWith("v1,")) continue;
    const provided = Buffer.from(candidate.slice("v1,".length), "base64");
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw new WebhookVerificationError(
      "No webhook-signature entry matches this payload and secret",
    );
  }

  const text =
    typeof input.payload === "string"
      ? input.payload
      : new TextDecoder().decode(input.payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new WebhookVerificationError("Verified payload is not valid JSON", {
      cause: error,
    });
  }
  const event = parsed as {
    id?: unknown;
    type?: unknown;
    created_at?: unknown;
  };
  if (typeof event.id !== "string" || typeof event.type !== "string") {
    throw new WebhookVerificationError(
      "Verified payload is not a BioFlow webhook event envelope",
    );
  }
  return parsed as WebhookEvent;
}

/** `client.webhooks` facade — verification needs no API key. */
export class Webhooks {
  verify(input: VerifyWebhookInput): WebhookEvent {
    return verifyWebhook(input);
  }
}
