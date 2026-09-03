import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The same two aliases the tsconfig declares, restated because Vitest resolves
 * modules itself and does not read `paths`. Two places to change is the cost of
 * not installing the workspace packages as runtime dependencies of a package
 * that inlines them.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@cms/seo": fileURLToPath(new URL("../seo/src/index.ts", import.meta.url)),
      "@cms/media/srcset": fileURLToPath(new URL("../media/src/srcset.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
