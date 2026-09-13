import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "server-only": new URL("./src/test/server-only.ts", import.meta.url).pathname } },
});
