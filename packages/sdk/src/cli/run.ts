import { resolve } from "node:path";
import { UnsafePlanError, applyPlan, formatOutcomes, formatRemainingWork } from "./apply";
import type { ApplyResult } from "./apply";
import { HELP, parseArgs } from "./args";
import type { EnvLike } from "./args";
import { detectProject } from "./detect";
import { fallbackPlan, fetchPlan, studioOriginFromApiUrl } from "./plan";
import type { ResolvedPlan } from "./plan";

/**
 * `npx @letternerd/sdk init`.
 *
 * Written as a function of its argv and its io rather than as a script, so the
 * behaviours worth protecting — it refuses a project that is not Next, it never
 * writes over a file, `--dry-run` touches nothing — are testable without a
 * subprocess. `index.ts` is three lines that call this.
 *
 * The exit code is the return value. A non-Next project is a 1, and so is a
 * studio that would not answer: both are states where continuing would leave a
 * repository half-installed with no indication of which half.
 */

export interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
  cwd: () => string;
  env: EnvLike;
  fetchImpl?: typeof fetch;
}

const defaultIo: Io = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  cwd: () => process.cwd(),
  env: process.env,
};

export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  const options = parseArgs(argv, io.env);

  if (options.help) {
    io.log(HELP);
    return 0;
  }

  const root = resolve(io.cwd(), options.root);

  const detection = detectProject(root);
  if (!detection.ok) {
    io.error("This is not a Next.js App Router project, so nothing was written.");
    io.error("");
    io.error(`  ${detection.reason}`);
    if (detection.found.length > 0) {
      io.error("");
      io.error("  Found instead:");
      for (const line of detection.found) io.error(`    ${line}`);
    }
    io.error("");
    io.error(`  Looked in: ${root}`);
    io.error("  Pass --dir to point at a different root.");
    return 1;
  }

  const facts = detection.facts;
  const packageManager = options.packageManager ?? facts.packageManager;

  const studioOrigin =
    options.studioUrl ?? (options.baseUrl ? studioOriginFromApiUrl(options.baseUrl) : null);

  let resolved: ResolvedPlan;
  if (options.studioUrl && options.key) {
    try {
      resolved = await fetchPlan({
        studioOrigin: options.studioUrl,
        key: options.key,
        blogPath: options.blogPathExplicit ? options.blogPath : undefined,
        packageManager,
        ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
      });
    } catch (error) {
      /**
       * Deliberately fatal. Falling back here would write nine files with a
       * placeholder API URL after the caller explicitly named a studio, and
       * there would be nothing in the output to suggest looking.
       */
      io.error("Could not fetch this site's install plan, so nothing was written.");
      io.error("");
      io.error(`  ${(error as Error).message}`);
      io.error("");
      io.error("  Run without --studio-url to use the SDK's built-in plan instead.");
      return 1;
    }
  } else {
    if (options.studioUrl && !options.key) {
      io.error(
        "Note: --studio-url was given without a key, so the built-in plan is being used instead " +
          "of this site's. Pass --key or set CMS_API_KEY to fetch the real one.",
      );
    }
    resolved = fallbackPlan({
      studioOrigin,
      apiUrl: options.baseUrl,
      siteUrl: options.siteUrl,
      blogPath: options.blogPath,
      packageManager,
    });
  }

  const { plan, source } = resolved;

  io.log(
    options.dryRun
      ? "Dry run — nothing will be written."
      : `Installing ${plan.install.package}@${plan.install.tag} into ${root}`,
  );
  io.log("");
  io.log(
    `  next ${facts.nextVersion}, app router at ${facts.appDir}/, ${facts.packageManager} lockfile`,
  );
  io.log(
    source === "studio"
      ? `  plan: fetched from ${plan.studio.origin} for "${plan.site.name}" (blog at ${plan.site.blogBasePath})`
      : `  plan: the SDK's built-in defaults (blog at ${plan.site.blogBasePath})`,
  );
  io.log("");

  let result: ApplyResult;
  try {
    result = applyPlan(plan, { root, srcDir: facts.srcDir, dryRun: options.dryRun });
  } catch (error) {
    if (!(error instanceof UnsafePlanError)) throw error;
    /**
     * Also fatal, and for a stronger reason than a studio that would not
     * answer: one that answered with a path outside the project is not the
     * studio. The summary is printed with the rejected paths marked so the
     * reader can see exactly what was asked for, and then nothing else happens.
     */
    io.error("This plan names paths outside the project, so nothing was written.");
    io.error("");
    for (const line of formatOutcomes({
      outcomes: error.outcomes,
      created: 0,
      skipped: error.outcomes.filter((outcome) => outcome.action === "skip").length,
      dryRun: options.dryRun,
    })) {
      io.error(line);
    }
    io.error("");
    io.error(`  ${error.message}`);
    io.error("  Check that --studio-url really is your studio before running this again.");
    return 1;
  }

  io.log(options.dryRun ? "Would write:" : "Files:");
  for (const line of formatOutcomes(result)) io.log(line);
  io.log("");
  io.log(
    options.dryRun
      ? `  ${result.created} would be created, ${result.skipped} left alone.`
      : `  ${result.created} created, ${result.skipped} left alone.`,
  );
  if (result.skipped > 0) {
    io.log(
      "  Nothing that already existed was touched. Compare each skipped file against the plan " +
        "yourself — run with --dry-run to print what this command would have written.",
    );
  }
  io.log("");

  for (const line of formatRemainingWork(plan, {
    nextConfigPath: facts.nextConfigPath,
    root,
  })) {
    io.log(line);
  }

  io.log("");
  io.log("Notes:");
  for (const note of plan.notes) io.log(`  - ${note}`);

  return 0;
}
