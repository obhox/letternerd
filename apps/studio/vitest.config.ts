import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Test setup for the studio app.
 *
 * Scoped to `src/**\/__tests__/**` on purpose: the app also contains
 * `scripts/`, and the packages have their own vitest runs. Widening the
 * include is how one workspace's suite starts picking up another's.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
  },
});
