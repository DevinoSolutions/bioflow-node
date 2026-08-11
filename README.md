# @bioflow/sdk

The official TypeScript SDK for the [BioFlow](https://getbioflow.com) public
API (`https://app.getbioflow.com/v1`) — typed access to pages, blocks,
publishing, contacts, files, analytics, usage, and outbound webhooks, plus a
[Standard Webhooks](https://www.standardwebhooks.com/) signature verifier.

- **Server-side only.** `bf_` API keys are secrets; the client refuses to
  construct in a browser.
- **Spec-derived types.** Every request/response type is generated from the
  API's OpenAPI 3.1 document — CI fails if the SDK drifts from the spec.
- **Zero runtime dependencies.** Node.js ≥ 18.17 (built-in `fetch`); Bun and
  `nodejs_compat` worker runtimes work too.

## Install

```sh
npm install @bioflow/sdk
```

> Previously published as `@getbioflow/sdk`. That scope is deprecated — switch
> the import path; the API is unchanged.

## Quickstart

Create an API key in **BioFlow → Settings** (Creator or Pro plan), then:

```ts
import BioFlow from "@bioflow/sdk";

const bioflow = new BioFlow({ apiKey: process.env.BIOFLOW_API_KEY! });

// List pages — one page of results…
const pages = await bioflow.pages.list({ limit: 20 });
console.log(pages.data.map((page) => page.slug));

// …or auto-paginate the whole collection.
for await (const contact of await bioflow.contacts.list()) {
  console.log(contact);
}

// Create, edit, publish.
const page = await bioflow.pages.create({ title: "Launch page" });
await bioflow.pages.addBlock(page.id, { kind: "LINK" });
await bioflow.pages.publish(page.id);
```

## Errors

Failures throw a typed hierarchy mirroring the API's RFC 9457 problem codes.
Branch on the class or on `error.code` — never parse messages.

```ts
import {
  NotFoundError,
  QuotaExhaustedError,
  RateLimitError,
} from "@bioflow/sdk";

try {
  await bioflow.pages.get("pg_missing");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log(error.code, error.requestId); // "resource_not_found", "req_…"
  }
}
```

| class                      | codes (status)                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `BadRequestError`          | `invalid_request` (400) — `error.errors` holds JSON-Pointer field errors                 |
| `AuthenticationError`      | `invalid_api_key` (401)                                                                  |
| `PermissionDeniedError`    | `insufficient_scope`, `feature_not_enabled`, `test_key_read_only` (403)                  |
| `NotFoundError`            | `resource_not_found` (404)                                                               |
| `ConflictError`            | `stale_snapshot`, `idempotency_in_progress` (409)                                        |
| `UnprocessableEntityError` | `idempotency_key_reused`, `endpoint_verification_failed`, `endpoint_limit_reached` (422) |
| `RateLimitError`           | `rate_limited` (429, per-key burst)                                                      |
| `QuotaExhaustedError`      | `quota_exhausted` (429, monthly plan quota — subclass of `RateLimitError`)               |
| `InternalServerError`      | `internal_error` (5xx)                                                                   |

Unknown future codes stay forward-compatible: the class follows the HTTP
status family and `error.code` carries the new value verbatim.

## Retries & idempotency

- Every consequential `POST` automatically gets an `Idempotency-Key`
  (`sdk_<uuid>`), reused across retries — the server dedupes instead of
  double-executing. Pass `{ idempotencyKey }` to control it, or
  `autoIdempotencyKeys: false` to opt out (which also disables POST retries).
- Retried (default `maxRetries: 2`): 429 `rate_limited` for any method;
  network errors, timeouts, 408 and 5xx for `GET`s and keyed `POST`s.
- Never retried: 429 `quota_exhausted` (waits until your monthly reset —
  handle it), `PATCH`/`DELETE` on ambiguous failures, and anything after your
  own `AbortSignal` fires.
- `Retry-After` is honored exactly; waits longer than `maxRetryAfterMs`
  (default 60 s) abandon the retry instead of sleeping.

```ts
await bioflow.pages.create(
  { title: "Exactly once" },
  { idempotencyKey: "order-1234", timeoutMs: 10_000 },
);
```

## Verifying webhooks

Verify BEFORE parsing, against the **raw** request bytes — any re-serialize
breaks the signature. Rotation overlap (two signatures) is handled.

```ts
import { verifyWebhook, WebhookVerificationError } from "@bioflow/sdk";

app.post("/bioflow-webhooks", express.raw({ type: "*/*" }), (req, res) => {
  let event;
  try {
    event = verifyWebhook({
      payload: req.body, // Buffer — the raw bytes
      headers: req.headers,
      secret: process.env.BIOFLOW_WEBHOOK_SECRET!, // whsec_… shown at endpoint creation
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).end();
    throw error;
  }
  // event.id (whmsg_…) is stable across retries — use it as your dedup key.
  switch (event.type) {
    case "contact.created":
      console.log(event.data.contact.email);
      break;
    case "page.published":
    case "sale.paid":
    case "sale.refunded":
      break;
    default: // new event types may appear — always keep a default branch
  }
  res.status(200).end();
});
```

## Escape hatches

```ts
// Raw request through the same auth/retry/error pipeline:
const { data, response, requestId } = await bioflow.request({
  method: "GET",
  path: "/v1/usage",
});

// Page-level pagination:
const first = await bioflow.pages.list({ limit: 50 });
if (first.hasNextPage()) {
  const second = await first.nextPage();
}
```

## Client options

```ts
new BioFlow({
  apiKey: "bf_live_…", // required
  baseUrl: "https://app.getbioflow.com",
  timeoutMs: 30_000,
  maxRetries: 2,
  authStyle: "bearer", // or "x-api-key"
  autoIdempotencyKeys: true,
  maxRetryAfterMs: 60_000,
  defaultHeaders: {},
  debug: false, // true | (line) => void — secrets are redacted
  fetch: globalThis.fetch,
  dangerouslyAllowBrowser: false,
});
```

## Development

This package is developed in the private BioFlow monorepo and mirrored to
[DevinoSolutions/bioflow-node](https://github.com/DevinoSolutions/bioflow-node);
issues and PRs are welcome on the mirror. Docs:
[getbioflow.com/developers](https://getbioflow.com/developers).

MIT © Devino Solutions Inc.
