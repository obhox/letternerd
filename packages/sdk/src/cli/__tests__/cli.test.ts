import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs, normalizeBlogPath } from "../args";
import { detectProject, rebasePath } from "../detect";
import { fallbackPlan, fetchPlan, studioOriginFromApiUrl } from "../plan";
import { run, type Io } from "../run";
import type { InstallPlan } from "../snippets";

/**
 * The command that writes into someone else's repository.
 *
 * Three properties are worth more than the rest and are tested directly: it
 * refuses a project that is not what it claims to handle, it never writes over
 * a file, and `--dry-run` really does nothing. The first two are the ones whose
 * failure is expensive and silent — an install into a Pages Router project
 * leaves nine dead files, and an overwrite destroys work with no record.
 */

const temps: string[] = [];

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "letternerd-cli-"));
  temps.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

function nextProject(extra: Record<string, string> = {}): string {
  return project({
    "package.json": JSON.stringify({ dependencies: { next: "^16.0.0", react: "^19.0.0" } }),
    "pnpm-lock.yaml": "",
    "app/layout.tsx": "export default function L() { return null; }",
    ...extra,
  });
}

function walk(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(root, join(prefix, entry.name))
      : [join(prefix, entry.name)],
  );
}

function io(env: Record<string, string | undefined> = {}, fetchImpl?: typeof fetch): Io & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    cwd: () => process.cwd(),
    env,
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("detecting the project", () => {
  it("accepts an app-router project and reports what it found", () => {
    const detection = detectProject(nextProject());
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.facts.appDir).toBe("app");
    expect(detection.facts.srcDir).toBe("");
    expect(detection.facts.nextVersion).toBe("^16.0.0");
    expect(detection.facts.nextConfigPath).toBeNull();
    expect(detection.facts.packageManager).toBe("pnpm");
  });

  it("finds an app router under src/, and moves the plan's paths with it", () => {
    const detection = detectProject(
      project({
        "package.json": JSON.stringify({ dependencies: { next: "15.1.0" } }),
        "src/app/layout.tsx": "",
        "next.config.ts": "export default {};",
      }),
    );
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.facts.srcDir).toBe("src");
    expect(detection.facts.nextConfigPath).toBe("next.config.ts");

    expect(rebasePath("app/rss.xml/route.ts", "src")).toBe("src/app/rss.xml/route.ts");
    expect(rebasePath("lib/cms.ts", "src")).toBe("src/lib/cms.ts");
    // Next reads its config from the root and nowhere else.
    expect(rebasePath("next.config.mjs", "src")).toBe("next.config.mjs");
  });

  it("names what it found when there is no package.json", () => {
    const detection = detectProject(project());
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.reason).toContain("No package.json");
  });

  it("names the dependencies it saw when next is not among them", () => {
    const detection = detectProject(
      project({
        "package.json": JSON.stringify({ dependencies: { react: "19", vite: "6" } }),
        "app/layout.tsx": "",
      }),
    );
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.reason).toContain("does not depend on `next`");
    expect(detection.found.join(" ")).toContain("react");
    expect(detection.found.join(" ")).toContain("vite");
  });

  it("says Pages Router rather than just 'not supported'", () => {
    const detection = detectProject(
      project({
        "package.json": JSON.stringify({ dependencies: { next: "14.2.0" } }),
        "pages/index.tsx": "",
      }),
    );
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.found.join(" ")).toContain("Pages Router");
    expect(detection.found.join(" ")).toContain("next: 14.2.0");
  });
});

describe("the arguments", () => {
  it("reads the flags, then the environment", () => {
    const options = parseArgs(["init", "--blog-path", "/insights", "--dry-run"], {
      CMS_API_URL: "https://studio.spendtab.com/api/v1",
      CMS_API_KEY: "cms_sk_from_env",
    });
    expect(options.blogPath).toBe("/insights");
    expect(options.blogPathExplicit).toBe(true);
    expect(options.dryRun).toBe(true);
    expect(options.baseUrl).toBe("https://studio.spendtab.com/api/v1");
    expect(options.key).toBe("cms_sk_from_env");
  });

  it("defaults the blog path but records that nobody asked for it", () => {
    const options = parseArgs([], {});
    expect(options.blogPath).toBe("/blog");
    expect(options.blogPathExplicit).toBe(false);
  });

  it("accepts --flag=value as well as --flag value", () => {
    expect(parseArgs(["--blog-path=/writing"], {}).blogPath).toBe("/writing");
  });

  it("normalises a blog path to root-relative with no trailing slash", () => {
    expect(normalizeBlogPath("insights/")).toBe("/insights");
    expect(normalizeBlogPath("/")).toBe("/");
  });

  it("derives the studio origin from an API base URL", () => {
    expect(studioOriginFromApiUrl("https://studio.spendtab.com/api/v1")).toBe(
      "https://studio.spendtab.com",
    );
  });
});

describe("the built-in fallback plan", () => {
  const plan = fallbackPlan({
    studioOrigin: "https://studio.spendtab.com",
    apiUrl: null,
    siteUrl: "https://spendtab.com",
    blogPath: "/insights",
    packageManager: "npm",
  }).plan;

  it("uses the requested blog path and package manager", () => {
    expect(plan.install.command).toBe("npm install @letternerd/sdk@next");
    expect(plan.files.map((file) => file.path)).toContain("app/insights/[slug]/page.tsx");
  });

  it("says out loud that it is not the site's own plan", () => {
    expect(plan.notes[0]).toContain("built-in plan, not this site's");
  });

  it("writes no file twice and marks none of them overwritable", () => {
    const paths = plan.files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const file of plan.files) expect(file.overwrite).toBe(false);
  });

  /**
   * The property that makes an unattended install safe at all.
   *
   * An agent applies this plan without reading the SDK. An import that does not
   * resolve would fail at `next build` on a customer's machine, after nine
   * files had already been written — so the names are checked against this
   * package's own source rather than against anyone's memory of it.
   */
  it("only imports symbols this SDK really exports", () => {
    const src = resolve(process.cwd(), "src");
    const source = readdirSync(src)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFileSync(join(src, file), "utf8"))
      .join("\n");

    const names = [
      ...new Set(
        [
          ...plan.files
            .map((file) => file.contents)
            .join("\n")
            .matchAll(/import \{([^}]+)\} from "@letternerd\/sdk[^"]*"/g),
        ].flatMap((match) => match[1]!.split(",").map((n) => n.replace(/^\s*type\s+/, "").trim())),
      ),
    ];

    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      const declared = new RegExp(
        `export (?:async )?(?:function|const|class|interface|type) ${name}\\b|^\\s{2}${name},$`,
        "m",
      );
      expect(source, `@letternerd/sdk does not export ${name}`).toMatch(declared);
    }
  });

  it("carries no credential", () => {
    for (const match of JSON.stringify(plan).matchAll(/cms_[sp]k_[A-Za-z0-9_-]*/g)) {
      expect(["cms_sk_", "cms_pk_", "cms_sk_PASTE_YOUR_READ_KEY_HERE"]).toContain(match[0]);
    }
    expect(plan.env.variables.find((v) => v.name === "CMS_API_KEY")!.value).toBeNull();
  });
});

describe("fetching this site's plan", () => {
  it("asks the studio's REST route with the key as a bearer token", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const stub = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ files: [{ path: "lib/cms.ts" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchPlan({
      studioOrigin: "https://studio.spendtab.com/",
      key: "cms_sk_live",
      blogPath: "/insights",
      packageManager: "pnpm",
      fetchImpl: stub,
    });

    expect(seen[0]!.url).toContain("https://studio.spendtab.com/api/v1/site/install-plan");
    expect(seen[0]!.url).toContain("blogBasePath=%2Finsights");
    expect(seen[0]!.headers["Authorization"]).toBe("Bearer cms_sk_live");
  });

  it("explains a 401 rather than reporting a number", async () => {
    const stub = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    await expect(
      fetchPlan({
        studioOrigin: "https://studio.spendtab.com",
        key: "nope",
        packageManager: "pnpm",
        fetchImpl: stub,
      }),
    ).rejects.toThrow(/401/);
  });
});

describe("running it", () => {
  it("refuses a project that is not Next, and writes nothing", async () => {
    const root = project({ "package.json": JSON.stringify({ dependencies: { astro: "5" } }) });
    const context = io();

    const code = await run(["init", "--dir", root], context);

    expect(code).toBe(1);
    expect(context.err.join("\n")).toContain("not a Next.js App Router project");
    expect(context.err.join("\n")).toContain("astro");
    expect(walk(root)).toEqual(["package.json"]);
  });

  it("writes the plan into an app-router project", async () => {
    const root = nextProject();
    const code = await run(["init", "--dir", root, "--blog-path", "/insights"], io());

    expect(code).toBe(0);
    const written = walk(root);
    expect(written).toContain("lib/cms.ts");
    expect(written).toContain(join("app", "insights", "[slug]", "page.tsx"));
    expect(written).toContain(join("app", "sitemap.xml", "route.ts"));
    expect(written).toContain(join("app", "api", "cms", "revalidate", "route.ts"));
    // The client it writes is the one the guide documents.
    expect(readFileSync(join(root, "lib/cms.ts"), "utf8")).toContain("createCmsClient");
  });

  it("never overwrites a file that exists, and says which it skipped", async () => {
    const mine = "// mine, and not to be replaced\n";
    const root = nextProject({
      "lib/cms.ts": mine,
      "app/sitemap.xml/route.ts": mine,
      "next.config.mjs": "export default {};\n",
    });
    const context = io();

    const code = await run(["init", "--dir", root], context);

    expect(code).toBe(0);
    expect(readFileSync(join(root, "lib/cms.ts"), "utf8")).toBe(mine);
    expect(readFileSync(join(root, "app/sitemap.xml/route.ts"), "utf8")).toBe(mine);
    expect(readFileSync(join(root, "next.config.mjs"), "utf8")).toBe("export default {};\n");

    const output = context.out.join("\n");
    expect(output).toContain("= lib/cms.ts");
    expect(output).toContain("skipped — already exists");
    expect(output).toContain("3 left alone");
    // An existing config is a merge instruction, never a rewrite of the file.
    expect(output).toContain("Merge the rewrite into the existing next.config.mjs");
  });

  it("writes nothing at all on a dry run", async () => {
    const root = nextProject();
    const before = walk(root);
    const context = io();

    const code = await run(["init", "--dir", root, "--dry-run"], context);

    expect(code).toBe(0);
    expect(walk(root)).toEqual(before);
    expect(existsSync(join(root, "lib/cms.ts"))).toBe(false);
    expect(context.out.join("\n")).toContain("Dry run — nothing will be written.");
    expect(context.out.join("\n")).toContain("9 would be created");
  });

  it("recommends the dry run in its own help text", async () => {
    const context = io();
    expect(await run(["--help"], context)).toBe(0);
    expect(context.out.join("\n")).toContain("--dry-run");
    expect(context.out.join("\n")).toContain("do this first");
  });

  it("prints the work it may not do: the env file, the key, the config", async () => {
    const root = nextProject({ "next.config.mjs": "export default {};\n" });
    const context = io();

    await run(["init", "--dir", root], context);
    const output = context.out.join("\n");

    expect(output).toContain(".env.local");
    expect(output).toContain("CMS_API_KEY=cms_sk_PASTE_YOUR_READ_KEY_HERE");
    expect(output).toContain("create_api_key");
    expect(output).toContain("Merge the rewrite into the existing");
    expect(output).toContain("pnpm add @letternerd/sdk@next");
    // The caveat that costs a customer a week if it is not said.
    expect(output).toContain("Outbound webhook delivery is NOT implemented");
    // It writes no .env.local of its own.
    expect(existsSync(join(root, ".env.local"))).toBe(false);
  });

  it("stops rather than falling back when a named studio will not answer", async () => {
    const root = nextProject();
    const stub = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const context = io({}, stub);

    const code = await run(
      ["init", "--dir", root, "--studio-url", "https://studio.spendtab.com", "--key", "bad"],
      context,
    );

    expect(code).toBe(1);
    expect(context.err.join("\n")).toContain("nothing was written");
    expect(walk(root)).not.toContain("lib/cms.ts");
  });

  it("applies a plan the studio really sent, paths and all", async () => {
    const root = nextProject();
    const plan: InstallPlan = {
      ...fallbackPlan({
        studioOrigin: "https://studio.spendtab.com",
        apiUrl: null,
        siteUrl: "https://spendtab.com",
        blogPath: "/from-the-studio",
        packageManager: "pnpm",
      }).plan,
      site: {
        name: "Spendtab",
        baseUrl: "https://spendtab.com",
        blogBasePath: "/from-the-studio",
        locale: "en-GB",
        sampleSlug: "cash-flow-basics",
      },
    };
    const stub = (async () =>
      new Response(JSON.stringify(plan), { status: 200 })) as unknown as typeof fetch;
    const context = io({}, stub);

    const code = await run(
      ["init", "--dir", root, "--studio-url", "https://studio.spendtab.com", "--key", "cms_sk_x"],
      context,
    );

    expect(code).toBe(0);
    expect(context.out.join("\n")).toContain("fetched from https://studio.spendtab.com");
    expect(walk(root)).toContain(join("app", "from-the-studio", "[slug]", "page.tsx"));
  });
});
