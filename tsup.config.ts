import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "neutral",
  // node:crypto stays external — the webhook verifier is server-oriented and
  // every supported runtime (Node >=18.17, Bun, workers with nodejs_compat)
  // provides it.
  external: ["node:crypto"],
});
