import { defineConfig } from "tsup";

/**
 * Three entries, because they have three different runtime requirements: the
 * core runs anywhere `fetch` exists, `next` needs React and Next, and `legacy`
 * needs neither. A consuming site that imports only the core must not be handed
 * a bundle that references `next/cache`.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    next: "src/next.tsx",
    legacy: "src/legacy.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  /**
   * The workspace packages are inlined rather than imported. They are private
   * to this monorepo and resolve to TypeScript sources; a consuming site has no
   * way to install `@cms/seo`, so a surviving `import "@cms/seo"` in `dist`
   * would be an unresolvable specifier on their machine, not ours.
   */
  noExternal: [/^@cms\//],
  /**
   * The peers stay peers. Bundling React would give a consuming app two copies
   * of it, and bundling Next is not even expressible — its server APIs are
   * provided by the running framework.
   */
  external: ["next", "react", "react-dom", /^next\//, /^react\//],
});
