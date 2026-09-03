import { defineConfig } from "vitest/config";

/**
 * One worker for this package.
 *
 * The pipeline loads shiki, which brings a WASM regex engine and a set of
 * TextMate grammars into every worker that touches it. Run alone the suite is
 * stable; run under `pnpm -r test`, where several packages' workers start at
 * once, grammar loading degrades under the memory pressure and a code fence
 * comes back unhighlighted — which surfaces as the byte-identical-output
 * assertion failing, non-deterministically and with a different count each run.
 *
 * The render itself is deterministic within a process; this is the test
 * environment, not the code. Capping parallelism here is cheaper and more
 * honest than making the assertion tolerant, which would retire the one test
 * that proves the pipeline's central promise.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
