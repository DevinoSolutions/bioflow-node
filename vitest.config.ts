import { defineConfig } from "vitest/config";

// No database, no env — the SDK suite runs against in-process mock HTTP
// servers only (the real-server proof lives in packages/api + apps/web).
export default defineConfig({
  test: {
    maxWorkers: 1,
  },
});
