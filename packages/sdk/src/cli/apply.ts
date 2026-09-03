import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rebasePath } from "./detect";
import { resolveInside } from "./safe-path";
import type { InstallPlan, PlanFile } from "./snippets";

/**
 * Writing the plan, and refusing to write over anything.
 *
 * The rule is absolute and there is no flag to relax it. A project that already
 * has `lib/cms.ts` or a post page has made decisions this plan cannot see, and
 * the cost of the two behaviours is not symmetric: a skipped file is a line of
 * output someone reads, and an overwritten one is work that no longer exists.
 * So every existing path is left exactly as it is and reported, and the summary
 * is the deliverable rather than an afterthought.
 *
 * The second rule is that nothing is written outside the project, and it is
 * enforced before the first rule gets a chance to matter. The plan is untrusted
 * input from a server; every path is checked up front, and a single bad one
 * aborts the whole apply with nothing written — because a plan that contains
 * `../../.bashrc` is not a plan with one bad entry, it is a plan from something
 * that is not the studio, and the "safe" entries next to it deserve no more
 * trust than the bad one did.
 */

export type Action = "create" | "skip";

export interface FileOutcome {
  /** As written, i.e. after rebasing onto `src/` where that applies. */
  path: string;
  action: Action;
  reason: string;
  bytes: number;
}

export interface ApplyResult {
  outcomes: FileOutcome[];
  created: number;
  skipped: number;
  dryRun: boolean;
}

export interface ApplyOptions {
  root: string;
  srcDir: "" | "src";
  dryRun: boolean;
}

/**
 * Thrown when a plan names a path the CLI will not write to.
 *
 * Carries the per-file outcomes so the caller can print the same summary it
 * would have printed on success, with the rejected entries marked as skipped
 * and their reasons alongside — the reason is the finding, and it belongs in
 * the output rather than in a stack trace.
 */
export class UnsafePlanError extends Error {
  readonly outcomes: FileOutcome[];

  constructor(outcomes: FileOutcome[]) {
    const rejected = outcomes.filter((outcome) => outcome.action === "skip");
    super(
      `The plan names ${rejected.length} path${rejected.length === 1 ? "" : "s"} outside what this ` +
        "command may write, so nothing was written.",
    );
    this.name = "UnsafePlanError";
    this.outcomes = outcomes;
  }
}

interface Placed {
  file: PlanFile;
  /** After rebasing onto `src/` where that applies. */
  relative: string;
  absolute: string;
}

/**
 * Every path resolved and checked, before any of them is touched.
 *
 * Returns the placements only if all of them are safe. Otherwise it throws with
 * an outcome per file — `create` for the ones that would have been fine, so the
 * summary still shows the whole plan — and the caller writes nothing.
 */
function placeAll(plan: InstallPlan, options: ApplyOptions): Placed[] {
  const placed: Placed[] = [];
  const outcomes: FileOutcome[] = [];
  let rejected = false;

  for (const file of plan.files) {
    const relative = rebasePath(file.path, options.srcDir);
    const bytes = Buffer.byteLength(file.contents, "utf8");
    try {
      placed.push({ file, relative, absolute: resolveInside(options.root, relative) });
      outcomes.push({ path: relative, action: "create", reason: file.purpose, bytes });
    } catch (error) {
      rejected = true;
      outcomes.push({ path: relative, action: "skip", reason: (error as Error).message, bytes });
    }
  }

  if (rejected) throw new UnsafePlanError(outcomes);
  return placed;
}

export function applyPlan(plan: InstallPlan, options: ApplyOptions): ApplyResult {
  const outcomes: FileOutcome[] = [];
  const seen = new Set<string>();

  for (const { file, relative, absolute } of placeAll(plan, options)) {
    const bytes = Buffer.byteLength(file.contents, "utf8");

    if (seen.has(relative)) {
      // Two entries for one path would mean the second silently won.
      outcomes.push({
        path: relative,
        action: "skip",
        reason: "the plan lists this path twice; only the first was considered",
        bytes,
      });
      continue;
    }
    seen.add(relative);

    if (existsSync(absolute)) {
      outcomes.push({ path: relative, action: "skip", reason: "already exists", bytes });
      continue;
    }

    if (!options.dryRun) {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, ensureTrailingNewline(file.contents), "utf8");
    }
    outcomes.push({ path: relative, action: "create", reason: file.purpose, bytes });
  }

  return {
    outcomes,
    created: outcomes.filter((outcome) => outcome.action === "create").length,
    skipped: outcomes.filter((outcome) => outcome.action === "skip").length,
    dryRun: options.dryRun,
  };
}

function ensureTrailingNewline(contents: string): string {
  return contents.endsWith("\n") ? contents : `${contents}\n`;
}

/**
 * The summary, shaped so a diff tool and a person read it the same way.
 *
 * `+` for a file that appeared, `=` for one that was already there. That is not
 * decoration: it means the output of two runs can be diffed, and it means an
 * agent can grep for `^=` to find every decision it still has to make.
 */
export function formatOutcomes(result: ApplyResult): string[] {
  const width = Math.max(0, ...result.outcomes.map((outcome) => outcome.path.length));
  return result.outcomes.map((outcome) => {
    const marker = outcome.action === "create" ? "+" : "=";
    const note =
      outcome.action === "create" ? `${outcome.bytes} bytes` : `skipped — ${outcome.reason}`;
    return `  ${marker} ${outcome.path.padEnd(width)}  ${note}`;
  });
}

/**
 * The part the CLI cannot do, stated as work rather than as a disclaimer.
 *
 * Four things are deliberately out of reach: the environment file holds
 * secrets, the key does not exist until a person mints one, the package manager
 * is the project's choice, and an existing Next config is a file with someone
 * else's decisions in it. Printing them as a checklist is the difference
 * between an install that finishes and one that appears to.
 */
export function formatRemainingWork(
  plan: InstallPlan,
  options: { nextConfigPath: string | null; root: string },
): string[] {
  const lines: string[] = [];

  lines.push("Still to do — none of this is something this command may do for you:");
  lines.push("");
  lines.push(`  1. Install the package:  ${plan.install.command}`);
  lines.push("");
  lines.push(`  2. Create ${join(options.root, plan.env.path)} with:`);
  for (const line of plan.env.snippet.split("\n")) lines.push(`       ${line}`);
  lines.push("");
  for (const variable of plan.env.variables) {
    if (variable.value !== null) continue;
    lines.push(`     ${variable.name}: ${variable.note}`);
  }
  lines.push("");

  if (options.nextConfigPath) {
    lines.push(`  3. Merge the rewrite into the existing ${options.nextConfigPath}:`);
    lines.push(
      `       { source: "${plan.nextConfig.rewrite.source}", destination: "${plan.nextConfig.rewrite.destination}" }`,
    );
    for (const instruction of plan.nextConfig.instructions) lines.push(`     - ${instruction}`);
  } else {
    lines.push(`  3. ${plan.nextConfig.path} was written for you — there was none.`);
  }

  lines.push("");
  lines.push("  4. Then check it worked:");
  for (const check of plan.verify) {
    lines.push(`     ${check.title}`);
    for (const line of check.command.split("\n")) lines.push(`       $ ${line}`);
    lines.push(`       expect: ${check.expect}`);
  }

  return lines;
}
