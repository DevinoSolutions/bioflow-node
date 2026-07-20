/**
 * SDK ↔ spec drift gates. The generated-types half of the gate lives in CI
 * (regenerate src/generated/v1.ts + git diff); this suite pins the halves a
 * type generator can't see: the operation registry mirrors the spec 1:1, the
 * retry-safety flags follow the server's ledger rules, and the published
 * version constant matches package.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PROBLEM_CODE_ERROR_CLASSES,
  QuotaExhaustedError,
  RateLimitError,
} from "./core/errors";
import { SDK_OPERATIONS } from "./operations";
import { VERSION } from "./version";

interface SpecOperation {
  operationId: string;
  method: string;
  path: string;
}

function readSpecOperations(): SpecOperation[] {
  const raw = readFileSync(
    new URL("../../api/openapi/v1.json", import.meta.url),
    "utf8",
  );
  const spec = JSON.parse(raw) as {
    paths: Record<string, Record<string, { operationId: string }>>;
  };
  const operations: SpecOperation[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
      });
    }
  }
  return operations;
}

describe("SDK operation registry mirrors packages/api/openapi/v1.json", () => {
  const specOperations = readSpecOperations();

  it("covers every spec operation and nothing else (22 operations)", () => {
    const specIds = specOperations.map((operation) => operation.operationId);
    expect(specIds).toHaveLength(22);
    expect(Object.keys(SDK_OPERATIONS).sort()).toEqual([...specIds].sort());
  });

  it("matches method and path template for every operation", () => {
    for (const operation of specOperations) {
      const sdkOperation =
        SDK_OPERATIONS[operation.operationId as keyof typeof SDK_OPERATIONS];
      expect(
        { id: operation.operationId, ...sdkOperation },
        operation.operationId,
      ).toEqual({
        id: operation.operationId,
        method: operation.method,
        path: operation.path,
        idempotent: sdkOperation.idempotent,
      });
    }
  });

  it("marks every POST idempotent (server ledgers all consequential POSTs) and nothing else", () => {
    for (const [id, operation] of Object.entries(SDK_OPERATIONS)) {
      expect(operation.idempotent, id).toBe(operation.method === "POST");
    }
  });
});

describe("published metadata", () => {
  it("exported VERSION constant matches the package.json version", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(packageJson.version);
  });
});

describe("error registry invariants", () => {
  it("keeps rate_limited and quota_exhausted distinct classes (retry semantics)", () => {
    expect(PROBLEM_CODE_ERROR_CLASSES["rate_limited"]).toBe(RateLimitError);
    expect(PROBLEM_CODE_ERROR_CLASSES["quota_exhausted"]).toBe(
      QuotaExhaustedError,
    );
    expect(QuotaExhaustedError.prototype).toBeInstanceOf(RateLimitError);
  });
});
