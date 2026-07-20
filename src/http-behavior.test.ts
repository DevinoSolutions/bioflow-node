/**
 * HTTP core behavior pins against a REAL in-process node:http server (no
 * fetch mocking — the actual wire path). Every promise in the D9 contract is
 * pinned here: auth header forms, retry eligibility per method, Retry-After
 * honoring, stable auto Idempotency-Keys across retries, quota_exhausted
 * never retried, typed problem errors, timeout/abort, pagination, redaction,
 * and the browser guard.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { BioFlow } from "./client";
import {
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  BioFlowError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  QuotaExhaustedError,
  RateLimitError,
} from "./core/errors";

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  atMs: number;
}

type Responder = (request: RecordedRequest, response: ServerResponse) => void;

class MockApi {
  readonly requests: RecordedRequest[] = [];
  private readonly responders: Responder[] = [];
  private server: Server | undefined;
  private baseUrl = "";

  respond(...responders: Responder[]): void {
    this.responders.push(...responders);
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        const recorded: RecordedRequest = {
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body,
          atMs: Date.now(),
        };
        this.requests.push(recorded);
        const responder = this.responders.shift();
        if (!responder) {
          res.writeHead(599).end("mock exhausted");
          return;
        }
        responder(recorded, res);
      });
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, "127.0.0.1", resolve),
    );
    const { port } = this.server?.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      this.server?.closeAllConnections?.();
    });
  }
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-request-id": headers["x-request-id"] ?? "req_mock",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function problem(
  res: ServerResponse,
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "application/problem+json",
    "x-request-id": "req_problem",
    ...headers,
  });
  res.end(
    JSON.stringify({
      type: `https://getbioflow.com/docs/api/errors/${code.replaceAll("_", "-")}`,
      title: "problem title",
      status,
      code,
      request_id: "req_problem",
      ...extra,
    }),
  );
}

const API_KEY = "bf_live_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF_12ab34cd";

let mock: MockApi;

async function startClient(
  overrides: Record<string, unknown> = {},
): Promise<BioFlow> {
  const baseUrl = await mock.start();
  return new BioFlow({
    apiKey: API_KEY,
    baseUrl,
    maxRetries: 2,
    ...overrides,
  });
}

afterEach(async () => {
  await mock?.stop();
  delete (globalThis as { window?: unknown }).window;
});

describe("auth and request shape", () => {
  it("sends Bearer auth, SDK identity headers and query params; exposes requestId", async () => {
    mock = new MockApi();
    mock.respond((_req, res) =>
      json(
        res,
        200,
        { data: [], has_more: false, next_cursor: null },
        { "x-request-id": "req_shape" },
      ),
    );
    const client = await startClient();
    const page = await client.pages.list({ limit: 5 });
    expect(page.data).toEqual([]);
    expect(page.requestId).toBe("req_shape");
    const request = mock.requests[0]!;
    expect(request.method).toBe("GET");
    expect(request.url).toBe("/v1/pages?limit=5");
    expect(request.headers["authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(request.headers["x-api-key"]).toBeUndefined();
    expect(request.headers["x-bioflow-client"]).toMatch(/^getbioflow-sdk\/\d/);
    expect(request.headers["user-agent"]).toMatch(/^getbioflow-sdk\/\d/);
    expect(request.headers["idempotency-key"]).toBeUndefined();
  });

  it("supports the x-api-key auth style", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => json(res, 200, { ok: true }));
    const client = await startClient({ authStyle: "x-api-key" });
    await client.usage.get();
    const request = mock.requests[0]!;
    expect(request.headers["x-api-key"]).toBe(API_KEY);
    expect(request.headers["authorization"]).toBeUndefined();
  });

  it("normalizes a trailing-slash baseUrl and returns undefined for 204", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => {
      res.writeHead(204, { "x-request-id": "req_del" }).end();
    });
    const baseUrl = await mock.start();
    const client = new BioFlow({ apiKey: API_KEY, baseUrl: `${baseUrl}/` });
    await expect(client.pages.delete("pg_1")).resolves.toBeUndefined();
    expect(mock.requests[0]!.url).toBe("/v1/pages/pg_1");
  });
});

describe("idempotency keys", () => {
  it("auto-generates an sdk_ Idempotency-Key on POST and REUSES it across retries", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) => problem(res, 500, "internal_error"),
      (_req, res) => json(res, 201, { id: "pg_new" }),
    );
    const client = await startClient();
    const created = await client.pages.create({ title: "T" });
    expect(created).toEqual({ id: "pg_new" });
    expect(mock.requests).toHaveLength(2);
    const firstKey = mock.requests[0]!.headers["idempotency-key"] as string;
    expect(firstKey).toMatch(/^sdk_/);
    expect(mock.requests[1]!.headers["idempotency-key"]).toBe(firstKey);
  });

  it("prefers a caller-supplied idempotencyKey", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => json(res, 201, { id: "pg" }));
    const client = await startClient();
    await client.pages.create({ title: "T" }, { idempotencyKey: "my-key-1" });
    expect(mock.requests[0]!.headers["idempotency-key"]).toBe("my-key-1");
  });

  it("with autoIdempotencyKeys off, POST sends no key and is NOT retried on 500", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => problem(res, 500, "internal_error"));
    const client = await startClient({ autoIdempotencyKeys: false });
    await expect(client.pages.create({ title: "T" })).rejects.toBeInstanceOf(
      InternalServerError,
    );
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.headers["idempotency-key"]).toBeUndefined();
  });
});

describe("retry policy", () => {
  it("retries GET on 500 then succeeds", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) => problem(res, 500, "internal_error"),
      (_req, res) => json(res, 200, { plan: "CREATOR" }),
    );
    const client = await startClient();
    await expect(client.usage.get()).resolves.toEqual({ plan: "CREATOR" });
    expect(mock.requests).toHaveLength(2);
  });

  it("never retries PATCH on 500", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => problem(res, 500, "internal_error"));
    const client = await startClient();
    await expect(
      client.pages.update("pg_1", {
        expected_updated_at: "2026-07-21T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(mock.requests).toHaveLength(1);
  });

  it("never retries DELETE on 500", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => problem(res, 500, "internal_error"));
    const client = await startClient();
    await expect(client.pages.delete("pg_1")).rejects.toBeInstanceOf(
      InternalServerError,
    );
    expect(mock.requests).toHaveLength(1);
  });

  it("retries 429 rate_limited for PATCH too (refused pre-execution) and honors Retry-After", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) =>
        problem(res, 429, "rate_limited", {}, { "retry-after": "1" }),
      (_req, res) => json(res, 200, { id: "pg_1" }),
    );
    const client = await startClient();
    const started = Date.now();
    await expect(
      client.pages.update("pg_1", {
        expected_updated_at: "2026-07-21T00:00:00.000Z",
      }),
    ).resolves.toEqual({ id: "pg_1" });
    expect(mock.requests).toHaveLength(2);
    const waited = mock.requests[1]!.atMs - mock.requests[0]!.atMs;
    expect(waited).toBeGreaterThanOrEqual(900);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("NEVER retries 429 quota_exhausted (instanceof RateLimitError still true)", async () => {
    mock = new MockApi();
    mock.respond((_req, res) =>
      problem(res, 429, "quota_exhausted", {}, { "retry-after": "3600" }),
    );
    const client = await startClient();
    const error = await client.usage.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as QuotaExhaustedError).retryAfterMs).toBe(3_600_000);
    expect(mock.requests).toHaveLength(1);
  });

  it("gives up instead of sleeping when Retry-After exceeds maxRetryAfterMs", async () => {
    mock = new MockApi();
    mock.respond((_req, res) =>
      problem(res, 429, "rate_limited", {}, { "retry-after": "2" }),
    );
    const client = await startClient({ maxRetryAfterMs: 100 });
    await expect(client.usage.get()).rejects.toBeInstanceOf(RateLimitError);
    expect(mock.requests).toHaveLength(1);
  });

  it("retries GET on connection errors (server socket destroyed)", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) => res.destroy(),
      (_req, res) => json(res, 200, { ok: true }),
    );
    const client = await startClient();
    await expect(client.usage.get()).resolves.toEqual({ ok: true });
    expect(mock.requests).toHaveLength(2);
  });
});

describe("typed problem errors", () => {
  it("maps registry codes to classes with code/type/requestId/field errors", async () => {
    mock = new MockApi();
    mock.respond((_req, res) =>
      problem(res, 400, "invalid_request", {
        detail: "starts_at must be in the future",
        errors: [
          {
            pointer: "/starts_at",
            code: "invalid_datetime",
            message: "must be in the future",
          },
        ],
      }),
    );
    const client = await startClient();
    const error = await client.usage.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestError);
    const bad = error as BadRequestError;
    expect(bad.code).toBe("invalid_request");
    expect(bad.status).toBe(400);
    expect(bad.requestId).toBe("req_problem");
    expect(bad.problemType).toBe(
      "https://getbioflow.com/docs/api/errors/invalid-request",
    );
    expect(bad.errors).toEqual([
      {
        pointer: "/starts_at",
        code: "invalid_datetime",
        message: "must be in the future",
      },
    ]);
    expect(bad.message).toContain("starts_at must be in the future");
  });

  it("maps invalid_api_key and resource_not_found", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) => problem(res, 401, "invalid_api_key"),
      (_req, res) => problem(res, 404, "resource_not_found"),
    );
    const client = await startClient({ maxRetries: 0 });
    await expect(client.usage.get()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await expect(client.pages.get("pg_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("keeps UNKNOWN codes forward-compatible via the status family", async () => {
    mock = new MockApi();
    mock.respond((_req, res) =>
      problem(res, 403, "brand_new_denial_code_2027"),
    );
    const client = await startClient();
    const error = await client.usage.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect((error as PermissionDeniedError).code).toBe(
      "brand_new_denial_code_2027",
    );
  });

  it("survives non-JSON error bodies", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => {
      res.writeHead(502, { "content-type": "text/plain" }).end("bad gateway");
    });
    const client = await startClient({ maxRetries: 0 });
    const error = await client.usage.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).code).toBe("unknown");
    expect((error as InternalServerError).status).toBe(502);
  });
});

describe("timeout and abort", () => {
  it("throws APITimeoutError when the per-request timeout elapses", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => {
      setTimeout(() => json(res, 200, { late: true }), 500);
    });
    const client = await startClient({ maxRetries: 0 });
    await expect(client.usage.get({ timeoutMs: 60 })).rejects.toBeInstanceOf(
      APITimeoutError,
    );
  });

  it("propagates a caller abort as APIUserAbortError without retrying", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => {
      setTimeout(() => json(res, 200, { late: true }), 500);
    });
    const client = await startClient();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      client.usage.get({ signal: controller.signal }),
    ).rejects.toBeInstanceOf(APIUserAbortError);
    expect(mock.requests).toHaveLength(1);
  });
});

describe("pagination", () => {
  const page1 = {
    data: [{ id: "c_1" }, { id: "c_2" }],
    has_more: true,
    next_cursor: "cur_2",
  };
  const page2 = { data: [{ id: "c_3" }], has_more: false, next_cursor: null };

  it("for-await walks every page, forwarding the cursor and original params", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) => json(res, 200, page1),
      (_req, res) => json(res, 200, page2),
    );
    const client = await startClient();
    const seen: string[] = [];
    for await (const contact of await client.contacts.list({ limit: 2 })) {
      seen.push((contact as { id: string }).id);
    }
    expect(seen).toEqual(["c_1", "c_2", "c_3"]);
    expect(mock.requests[0]!.url).toBe("/v1/contacts?limit=2");
    expect(mock.requests[1]!.url).toBe("/v1/contacts?limit=2&after=cur_2");
  });

  it("exposes the page escape hatch (data / has_more / nextPage)", async () => {
    mock = new MockApi();
    mock.respond(
      (_req, res) => json(res, 200, page1),
      (_req, res) => json(res, 200, page2),
    );
    const client = await startClient();
    const first = await client.contacts.list();
    expect(first.data).toHaveLength(2);
    expect(first.hasNextPage()).toBe(true);
    const second = await first.nextPage();
    expect(second?.data).toEqual([{ id: "c_3" }]);
    expect(second?.hasNextPage()).toBe(false);
    await expect(second?.nextPage() ?? null).resolves.toBeNull();
  });
});

describe("guard rails", () => {
  it("debug logging emits redacted lines only — the API key never appears", async () => {
    mock = new MockApi();
    mock.respond((_req, res) => problem(res, 401, "invalid_api_key"));
    const lines: string[] = [];
    const client = await startClient({
      maxRetries: 0,
      debug: (line: string) => lines.push(line),
    });
    await client.usage.get().catch(() => undefined);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.every((line) => line.startsWith("[bioflow-sdk]"))).toBe(true);
    expect(lines.join("\n")).not.toContain(API_KEY);
    expect(lines.join("\n")).not.toContain("bf_live_");
  });

  it("refuses to construct in a browser-like environment unless explicitly allowed", () => {
    (globalThis as { window?: unknown }).window = { document: {} };
    expect(() => new BioFlow({ apiKey: API_KEY })).toThrow(BioFlowError);
    expect(
      () => new BioFlow({ apiKey: API_KEY, dangerouslyAllowBrowser: true }),
    ).not.toThrow();
  });

  it("throws at construction when apiKey is empty", () => {
    expect(() => new BioFlow({ apiKey: "" })).toThrow(BioFlowError);
  });
});
