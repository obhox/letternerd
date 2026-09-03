import type { PackageManager } from "./snippets";

/**
 * Argument parsing, and the help text that is the CLI's real documentation.
 *
 * Kept apart from the command so both are testable and so the help text sits
 * next to the flags it describes. A help text written somewhere else is a help
 * text that describes a previous version of the flags.
 */

export interface CliOptions {
  root: string;
  /** The CMS API base, e.g. `https://studio.example.com/api/v1`. */
  baseUrl: string | null;
  /** The studio origin, for fetching this site's real plan. */
  studioUrl: string | null;
  /** The consuming site's own origin, for the verification commands. */
  siteUrl: string | null;
  blogPath: string;
  /**
   * Whether `blogPath` was asked for or merely defaulted. A studio knows the
   * site's real path; sending the default over it would silently override the
   * one value the CMS is authoritative about.
   */
  blogPathExplicit: boolean;
  key: string | null;
  packageManager: PackageManager | null;
  dryRun: boolean;
  help: boolean;
}

export const HELP = `letternerd-sdk init — install @letternerd/sdk into a Next.js App Router project

  npx @letternerd/sdk init --dry-run          # do this first
  npx @letternerd/sdk init

Writes the files a Letternerd integration needs — lib/cms.ts, the post page, the
four artifact routes, the markdown route and the revalidation webhook — into the
project in the current directory. It never overwrites a file that already
exists: anything present is left alone and reported as skipped.

Start with --dry-run. It prints exactly what would be written and what would be
skipped, and touches nothing.

Options
  --dry-run                 Print the plan and change nothing. Recommended first run.
  --dir <path>              Project root. Default: the current directory.
  --studio-url <url>        Studio origin, e.g. https://studio.example.com. With a
                            key, fetches this site's real plan instead of the
                            built-in one.
  --key <key>               A read key (cms_sk_…) for --studio-url. Read from
                            CMS_API_KEY when not passed. Never written to disk.
  --base-url <url>          CMS API base, e.g. https://studio.example.com/api/v1.
                            Read from CMS_API_URL.
  --site-url <url>          The site's own origin, e.g. https://example.com. Used
                            for the verification commands. Read from CMS_SITE_URL.
  --blog-path <path>        Root-relative blog path, e.g. /blog. Read from
                            CMS_BLOG_PATH. Default: /blog.
  --package-manager <name>  pnpm | npm | yarn. Default: whichever lockfile is present.
  -h, --help                This.

What it will not do
  It does not write .env.local, it never mints or prints an API key, it does not
  run your package manager, and it does not edit an existing next.config. Each of
  those is printed at the end with what you need to do by hand.
`;

const PACKAGE_MANAGERS: readonly string[] = ["pnpm", "npm", "yarn"];

function readEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.replace(/^--?/, "").split(/=(.*)/s);
    if (inline !== undefined) {
      flags.set(name!, inline);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      flags.set(name!, next);
      i += 1;
    } else {
      flags.set(name!, true);
    }
  }

  const stringFlag = (name: string): string | null => {
    const value = flags.get(name);
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  const requestedBlogPath = stringFlag("blog-path") ?? readEnv(env, "CMS_BLOG_PATH");
  const requested = stringFlag("package-manager");
  const packageManager =
    requested && PACKAGE_MANAGERS.includes(requested) ? (requested as PackageManager) : null;

  return {
    // `init` is the only verb, so it is accepted and ignored rather than
    // required — an agent that types it and one that does not both work.
    root: stringFlag("dir") ?? positional.find((word) => word !== "init") ?? ".",
    baseUrl: stringFlag("base-url") ?? readEnv(env, "CMS_API_URL"),
    studioUrl: stringFlag("studio-url") ?? readEnv(env, "CMS_STUDIO_URL"),
    siteUrl: stringFlag("site-url") ?? readEnv(env, "CMS_SITE_URL", "NEXT_PUBLIC_SITE_URL"),
    blogPath: normalizeBlogPath(requestedBlogPath ?? "/blog"),
    blogPathExplicit: requestedBlogPath !== null,
    key: stringFlag("key") ?? readEnv(env, "CMS_API_KEY"),
    packageManager,
    dryRun: flags.has("dry-run"),
    help: flags.has("help") || flags.has("h"),
  };
}

/** Root-relative, no trailing slash — the form every path builder assumes. */
export function normalizeBlogPath(value: string): string {
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  const trimmed = withLeading.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
