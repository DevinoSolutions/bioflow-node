/**
 * Webhook verifier semantics — Standard Webhooks v1 as the server signs it.
 * The authoritative mirror pin (server signWebhook → SDK verifyWebhook) lives
 * in packages/api/src/public/sdk-mirror.test.ts; this suite pins the
 * verifier's own edge behavior with a local signer.
 */
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WebhookVerificationError } from "./core/errors";
import { verifyWebhook } from "./webhooks";

function makeSecret(): string {
  return `whsec_${randomBytes(24).toString("base64")}`;
}

function sign(
  secret: string,
  id: string,
  timestampSeconds: number,
  rawBody: string,
): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const digest = createHmac("sha256", key)
    .update(`${id}.${timestampSeconds}.${rawBody}`, "utf8")
    .digest("base64");
  return `v1,${digest}`;
}

const NOW = new Date("2026-07-21T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function makeDelivery(overrides?: { body?: string; type?: string }) {
  const secret = makeSecret();
  const id = "whmsg_evt_123";
  const body =
    overrides?.body ??
    JSON.stringify({
      id,
      type: overrides?.type ?? "page.published",
      created_at: NOW.toISOString(),
      data: {
        page: {
          id: "pg_1",
          title: "My page",
          slug: "my-page",
          published_at: NOW.toISOString(),
        },
      },
    });
  const headers = {
    "webhook-id": id,
    "webhook-timestamp": String(NOW_SECONDS),
    "webhook-signature": sign(secret, id, NOW_SECONDS, body),
  };
  return { secret, id, body, headers };
}

describe("verifyWebhook", () => {
  it("verifies a valid delivery and returns the typed event", () => {
    const { secret, body, headers } = makeDelivery();
    const event = verifyWebhook({ payload: body, headers, secret, now: NOW });
    expect(event.type).toBe("page.published");
    if (event.type === "page.published") {
      expect(event.data.page.slug).toBe("my-page");
    }
    expect(event.id).toBe("whmsg_evt_123");
  });

  it("verifies raw Uint8Array bytes identically to the string form", () => {
    const { secret, body, headers } = makeDelivery();
    const event = verifyWebhook({
      payload: new TextEncoder().encode(body),
      headers,
      secret,
      now: NOW,
    });
    expect(event.type).toBe("page.published");
  });

  it("accepts a Headers instance", () => {
    const { secret, body, headers } = makeDelivery();
    const event = verifyWebhook({
      payload: body,
      headers: new Headers(headers),
      secret,
      now: NOW,
    });
    expect(event.id).toBe("whmsg_evt_123");
  });

  it("resolves header names case-insensitively from plain records", () => {
    const { secret, body, headers } = makeDelivery();
    const event = verifyWebhook({
      payload: body,
      headers: {
        "Webhook-Id": headers["webhook-id"],
        "WEBHOOK-TIMESTAMP": headers["webhook-timestamp"],
        "Webhook-Signature": [headers["webhook-signature"]],
      },
      secret,
      now: NOW,
    });
    expect(event.id).toBe("whmsg_evt_123");
  });

  it("rejects a tampered payload", () => {
    const { secret, body, headers } = makeDelivery();
    const tampered = body.replace("my-page", "evil-page");
    expect(() =>
      verifyWebhook({ payload: tampered, headers, secret, now: NOW }),
    ).toThrow(WebhookVerificationError);
  });

  it("rejects a parse-then-reserialize of the same JSON (raw bytes rule)", () => {
    const spaced = `{ "id": "whmsg_evt_123",  "type": "endpoint.test", "created_at": "${NOW.toISOString()}", "data": { "message": "hi" } }`;
    const { secret } = makeDelivery();
    const headers = {
      "webhook-id": "whmsg_evt_123",
      "webhook-timestamp": String(NOW_SECONDS),
      "webhook-signature": sign(secret, "whmsg_evt_123", NOW_SECONDS, spaced),
    };
    expect(
      verifyWebhook({ payload: spaced, headers, secret, now: NOW }).type,
    ).toBe("endpoint.test");
    const reserialized = JSON.stringify(JSON.parse(spaced));
    expect(reserialized).not.toBe(spaced);
    expect(() =>
      verifyWebhook({ payload: reserialized, headers, secret, now: NOW }),
    ).toThrow(WebhookVerificationError);
  });

  it("rejects the wrong secret", () => {
    const { body, headers } = makeDelivery();
    expect(() =>
      verifyWebhook({ payload: body, headers, secret: makeSecret(), now: NOW }),
    ).toThrow(WebhookVerificationError);
  });

  it("enforces the 300s timestamp tolerance on both sides", () => {
    const { secret, body, headers } = makeDelivery();
    const justInside = new Date(NOW.getTime() + 299_000);
    const justOutside = new Date(NOW.getTime() + 301_000);
    expect(
      verifyWebhook({ payload: body, headers, secret, now: justInside }).id,
    ).toBe("whmsg_evt_123");
    expect(() =>
      verifyWebhook({ payload: body, headers, secret, now: justOutside }),
    ).toThrow(WebhookVerificationError);
    const behind = new Date(NOW.getTime() - 301_000);
    expect(() =>
      verifyWebhook({ payload: body, headers, secret, now: behind }),
    ).toThrow(WebhookVerificationError);
  });

  it("verifies against ANY entry of a rotation dual-signature header", () => {
    const oldSecret = makeSecret();
    const newSecret = makeSecret();
    const id = "whmsg_evt_rot";
    const body = JSON.stringify({
      id,
      type: "endpoint.test",
      created_at: NOW.toISOString(),
      data: { message: "rotation" },
    });
    const headers = {
      "webhook-id": id,
      "webhook-timestamp": String(NOW_SECONDS),
      "webhook-signature": `${sign(newSecret, id, NOW_SECONDS, body)} ${sign(oldSecret, id, NOW_SECONDS, body)}`,
    };
    expect(
      verifyWebhook({ payload: body, headers, secret: newSecret, now: NOW }).id,
    ).toBe(id);
    expect(
      verifyWebhook({ payload: body, headers, secret: oldSecret, now: NOW }).id,
    ).toBe(id);
  });

  it("ignores non-v1 signature entries", () => {
    const { secret, body, headers } = makeDelivery();
    const withNoise = {
      ...headers,
      "webhook-signature": `v2,${Buffer.from("nope").toString("base64")} ${headers["webhook-signature"]}`,
    };
    expect(
      verifyWebhook({ payload: body, headers: withNoise, secret, now: NOW }).id,
    ).toBe("whmsg_evt_123");
  });

  it("throws on missing headers, malformed timestamp, non-JSON and non-envelope payloads", () => {
    const { secret, body, headers } = makeDelivery();
    for (const missing of [
      "webhook-id",
      "webhook-timestamp",
      "webhook-signature",
    ]) {
      const partial: Record<string, string> = { ...headers };
      delete partial[missing];
      expect(() =>
        verifyWebhook({ payload: body, headers: partial, secret, now: NOW }),
      ).toThrow(WebhookVerificationError);
    }
    expect(() =>
      verifyWebhook({
        payload: body,
        headers: { ...headers, "webhook-timestamp": "not-a-number" },
        secret,
        now: NOW,
      }),
    ).toThrow(WebhookVerificationError);

    const rawText = "just text, signed correctly";
    const textHeaders = {
      "webhook-id": "whmsg_x",
      "webhook-timestamp": String(NOW_SECONDS),
      "webhook-signature": sign(secret, "whmsg_x", NOW_SECONDS, rawText),
    };
    expect(() =>
      verifyWebhook({
        payload: rawText,
        headers: textHeaders,
        secret,
        now: NOW,
      }),
    ).toThrow(WebhookVerificationError);

    const nonEnvelope = JSON.stringify({ hello: "world" });
    const envHeaders = {
      "webhook-id": "whmsg_y",
      "webhook-timestamp": String(NOW_SECONDS),
      "webhook-signature": sign(secret, "whmsg_y", NOW_SECONDS, nonEnvelope),
    };
    expect(() =>
      verifyWebhook({
        payload: nonEnvelope,
        headers: envHeaders,
        secret,
        now: NOW,
      }),
    ).toThrow(WebhookVerificationError);
  });
});
