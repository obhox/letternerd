import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Is this a Next.js App Router project?
 *
 * The command writes nine files into someone's repository. Getting the answer
 * wrong here is the difference between an install and a mess, so the check is
 * three separate facts rather than one heuristic, and a refusal names which
 * fact was missing and what was found instead. "Not a Next.js project" sends
 * someone looking in the wrong place; "package.json lists react and vite but
 * not next" does not.
 */

export interface ProjectFacts {
  root: string;
  /** "" for `app/` at the root, "src" for `src/app/`. */
  srcDir: "" | "src";
  appDir: string;
  nextVersion: string;
  /** The config file that already exists, or null. */
  nextConfigPath: string | null;
  packageManager: "pnpm" | "npm" | "yarn";
}

export type Detection =
  | { ok: true; facts: ProjectFacts }
  | { ok: false; reason: string; found: string[] };

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

const NEXT_CONFIGS = [
  "next.config.mjs",
  "next.config.js",
  "next.config.ts",
  "next.config.cjs",
  "next.config.mts",
];

/** The lockfile is the only honest answer to "which package manager?". */
export function detectPackageManager(root: string): "pnpm" | "npm" | "yarn" {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  return "pnpm";
}

export function detectProject(root: string): Detection {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      ok: false,
      reason: `No package.json in ${root}. Run this from the root of the site you are installing into, or pass --dir.`,
      found: [],
    };
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
  } catch (error) {
    return {
      ok: false,
      reason: `${packageJsonPath} is not valid JSON: ${(error as Error).message}`,
      found: [],
    };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const nextVersion = deps["next"];
  if (!nextVersion) {
    const names = Object.keys(deps).sort();
    return {
      ok: false,
      reason:
        "package.json does not depend on `next`. This SDK's route handlers and components are " +
        "Next.js App Router specific and there is no Pages Router or non-Next variant.",
      found:
        names.length > 0
          ? [`dependencies: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}`]
          : ["dependencies: none"],
    };
  }

  const hasRootApp = existsSync(join(root, "app"));
  const hasSrcApp = existsSync(join(root, "src", "app"));
  if (!hasRootApp && !hasSrcApp) {
    const found: string[] = [`next: ${nextVersion}`];
    if (existsSync(join(root, "pages"))) found.push("pages/ (Pages Router)");
    if (existsSync(join(root, "src", "pages"))) found.push("src/pages/ (Pages Router)");
    if (found.length === 1) found.push("neither app/ nor src/app/");
    return {
      ok: false,
      reason:
        "No App Router directory. Every file in the plan is an App Router file — route handlers " +
        "in folders whose names are their URLs, and React Server Components — so there is nothing " +
        "useful to write into a Pages Router project.",
      found,
    };
  }

  const srcDir: "" | "src" = hasRootApp ? "" : "src";

  return {
    ok: true,
    facts: {
      root,
      srcDir,
      appDir: srcDir === "" ? "app" : "src/app",
      nextVersion,
      nextConfigPath: NEXT_CONFIGS.find((name) => existsSync(join(root, name))) ?? null,
      packageManager: detectPackageManager(root),
    },
  };
}

/**
 * Move a plan's paths into `src/` when that is where the project keeps them.
 *
 * The plan is written against `app/` and `lib/`, because that is what the
 * studio's guide shows and what the CMS knows. A project using `src/app` would
 * otherwise get a second, dead `app/` directory at its root — which Next then
 * refuses to build alongside the real one, so the failure is at least loud.
 * `next.config.*` stays at the root, because that is the only place Next reads
 * it from.
 */
export function rebasePath(path: string, srcDir: "" | "src"): string {
  if (srcDir === "") return path;
  if (path.startsWith("app/") || path.startsWith("lib/")) return `src/${path}`;
  return path;
}
