import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getTableName, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SCOPES, isCmsError, type Actor, type CapabilityServices } from "@cms/core";
import type { StorageService } from "@cms/media";
import {
  KEY_PLACEHOLDER,
  buildInstallPlan,
  getInstallPlan,
  installCommand,
  readStudioOrigin,
  type InstallPlan,
  type InstallValues,
} from "../install";

/**
 * The plan an agent installs from.
 *
 * The failure mode worth testing here is not a crash. It is a plan that looks
 * right — real-looking paths, plausible imports — and produces a repository
 * that does not build, or one that contains a credential this API should never
 * have handed out. Both read fine in review, which is exactly why they need a
 * test rather than a reviewer.
 */

const SITE = "11111111-1111-4111-8111-111111111111";

/** A site that uses neither default, so a missing substitution is obvious. */
const SITE_ROW = {
  id: SITE,
  name: "Spendtab",
  baseUrl: "https://spendtab.com",
  blogBasePath: "/insights",
  locale: "en-GB",
};

/**
 * The smallest thing that can stand in for drizzle here.
 *
 * Two reads: the site row and one published slug. Every builder method returns
 * the same thenable and the rows come from a per-table queue, which is enough
 * because this handler is being tested for what it emits rather than for the
 * SQL it emits it with.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  function chain(table: Table) {
    const node: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit"]) node[method] = () => node;
    node.then = (onFulfilled: (r: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => rows[getTableName(table)] ?? [])
        .then(onFulfilled, onRejected);
    return node;
  }
  return {
    select: () => ({ from: (table: Table) => chain(table) }),
  };
}

function services(rows: Record<string, unknown[]> = {}): CapabilityServices {
  return {
    db: fakeDb({ sites: [SITE_ROW], documents: [{ slug: "cash-flow-basics" }], ...rows }),
    storage: {} as StorageService,
    now: () => new Date("2026-01-01T00:00:00Z"),
  } as unknown as CapabilityServices;
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    kind: "api_key",
    id: "key_1",
    siteId: SITE,
    role: "author",
    scopes: [...SCOPES],
    publishedOnly: true,
    ...overrides,
  };
}

async function plan(input: Record<string, unknown> = {}, rows?: Record<string, unknown[]>) {
  return (await getInstallPlan.invoke(input, {
    actor: actor(),
    services: services(rows),
  })) as InstallPlan;
}

describe("get_install_plan", () => {
  it("is a read-only content read that an author may make", () => {
    expect(getInstallPlan.readOnly).toBe(true);
    expect(getInstallPlan.scopes).toEqual(["content:read"]);
    expect(getInstallPlan.role).toBe("author");
    expect(getInstallPlan.route).toEqual({ method: "GET", path: "/install-plan" });
  });

  it("tells an agent it returns files and that it must read before writing", () => {
    const description = getInstallPlan.description.toLowerCase();
    expect(description).toContain("files to write");
    expect(description).toContain("overwrite: false");
    expect(description).toMatch(/read the project before writing/);
    // The one thing it must promise not to do.
    expect(description).toMatch(/never (returns|mints) an api key|never returns an api key/);
  });

  it("uses the site's real blog base path in every path it emits", async () => {
    const result = await plan();

    expect(result.site.blogBasePath).toBe("/insights");
    expect(result.files.map((file) => file.path)).toContain("app/insights/[slug]/page.tsx");
    // `/blog` is the README's example and the default nobody edited.
    for (const file of result.files) {
      expect(file.path).not.toContain("app/blog/");
      expect(file.contents).not.toContain("app/blog/[slug]");
    }
    expect(result.nextConfig.rewrite).toEqual({
      source: "/insights/:slug.md",
      destination: "/api/cms/markdown/:slug",
    });
  });

  it("lets a caller override the blog path, and says so when it disagrees", async () => {
    const result = await plan({ blogBasePath: "/writing" });

    expect(result.files.map((file) => file.path)).toContain("app/writing/[slug]/page.tsx");
    expect(result.notes.join("\n")).toContain("Canonical URLs");
    expect(result.notes.join("\n")).toContain("/insights");
  });

  it("refuses a blog path that is not root-relative", async () => {
    await expect(plan({ blogBasePath: "insights" })).rejects.toSatisfy(
      (error: unknown) => isCmsError(error) && error.code === "invalid_input",
    );
  });

  it("never carries a credential, only a placeholder", async () => {
    const result = await plan();
    const serialized = JSON.stringify(result);

    const key = result.env.variables.find((variable) => variable.name === "CMS_API_KEY")!;
    expect(key.value).toBeNull();
    expect(key.placeholder).toBe(KEY_PLACEHOLDER);
    expect(key.secret).toBe(true);
    // Names the capability that mints one, and says a person decides.
    expect(key.note).toContain("create_api_key");

    /**
     * A real read key is `cms_sk_` followed by random characters. The
     * placeholder shares the prefix on purpose — it has to look like the thing
     * it replaces — so the assertion is that every occurrence is either that
     * exact placeholder or the bare prefix, which the prose uses to name the
     * kind of key. Anything else with characters after the prefix is a key.
     */
    const PREFIXES = ["cms_sk_", "cms_pk_"];
    for (const match of serialized.matchAll(/cms_[sp]k_[A-Za-z0-9_-]*/g)) {
      const found = match[0];
      expect(
        found === KEY_PLACEHOLDER || PREFIXES.includes(found),
        `plan contains what looks like a key: ${found}`,
      ).toBe(true);
    }
    expect(serialized).not.toMatch(/CMS_WEBHOOK_SECRET=[A-Za-z0-9+/]{16,}/);
  });

  it("writes no file twice", async () => {
    const paths = (await plan()).files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("marks every file unsafe to overwrite", async () => {
    for (const file of (await plan()).files) {
      expect(file.overwrite, `${file.path} may not be overwritten`).toBe(false);
      expect(file.contents.length, `${file.path} is empty`).toBeGreaterThan(0);
      expect(file.purpose.length, `${file.path} has no purpose`).toBeGreaterThan(20);
      // Relative to the project root: a leading slash would write to the disk root.
      expect(file.path.startsWith("/")).toBe(false);
    }
  });

  it("covers the client, the post page, four artifacts, markdown and the webhook", async () => {
    expect((await plan()).files.map((file) => file.path)).toEqual([
      "lib/cms.ts",
      "app/insights/[slug]/page.tsx",
      "app/sitemap.xml/route.ts",
      "app/robots.txt/route.ts",
      "app/rss.xml/route.ts",
      "app/llms.txt/route.ts",
      "app/api/cms/markdown/[slug]/route.ts",
      "next.config.mjs",
      "app/api/cms/revalidate/route.ts",
    ]);
  });

  it("describes the next config as a merge rather than a replacement", async () => {
    const { nextConfig } = await plan();
    expect(nextConfig.merge).toBe(true);
    expect(nextConfig.instructions.join(" ")).toContain("not a replacement");
    // The file also appears in `files`, for a project that genuinely has none.
    expect(nextConfig.path).toBe("next.config.mjs");
  });

  it("emits the package-manager command the caller asked for", async () => {
    expect((await plan()).install.command).toBe("pnpm add @letternerd/sdk@next");
    expect((await plan({ packageManager: "npm" })).install.command).toBe(
      "npm install @letternerd/sdk@next",
    );
    expect(installCommand("yarn")).toBe("yarn add @letternerd/sdk@next");
  });

  it("verifies against the consuming domain and says what each failure means", async () => {
    const { verify } = await plan();
    expect(verify.length).toBeGreaterThan(0);
    for (const check of verify) {
      expect(check.failure.length, `${check.id} does not say what a failure means`).toBeGreaterThan(
        80,
      );
      if (check.id === "key") continue;
      expect(check.command).toContain("spendtab.com");
      expect(check.command).not.toContain("studio.spendtab.com");
    }
  });

  it("admits that publishing does not yet purge a consuming site's cache", async () => {
    const notes = (await plan()).notes.join("\n");
    expect(notes).toContain("Outbound webhook delivery is NOT implemented");
    expect(notes).toContain("revalidate");
  });

  it("says so when nothing is published, rather than pointing curl at a 404", async () => {
    const result = await plan({}, { documents: [] });
    expect(result.site.sampleSlug).toBeNull();
    expect(result.notes.join("\n")).toContain("Nothing is published on this site yet");
  });
});

describe("the studio origin", () => {
  it("comes from the environment and loses a trailing slash", () => {
    expect(readStudioOrigin({ CMS_STUDIO_URL: "https://studio.spendtab.com/" })).toBe(
      "https://studio.spendtab.com",
    );
    expect(readStudioOrigin({})).toBeNull();
    expect(readStudioOrigin({ CMS_STUDIO_URL: "  " })).toBeNull();
  });
});

/**
 * The guarantee the studio's own snippet test makes, restated on this side of
 * the move.
 *
 * A plan with an import that does not resolve is worse than no plan: it looks
 * authoritative and fails at build time on someone else's machine, after an
 * agent has already written nine files. So the names are checked against the
 * SDK's source rather than against anyone's memory of it — rename an export in
 * `packages/sdk` and this fails here, in CI, instead of there, in a customer's
 * repository.
 */
describe("the emitted code", () => {
  const VALUES: InstallValues = {
    siteName: "Spendtab",
    studioOrigin: "https://studio.spendtab.com",
    baseUrl: "https://spendtab.com",
    blogBasePath: "/insights",
    locale: "en-GB",
    sampleSlug: "cash-flow-basics",
  };

  function importedNames(): string[] {
    const source = buildInstallPlan(VALUES)
      .files.map((file) => file.contents)
      .join("\n");
    return [
      ...new Set(
        [...source.matchAll(/import \{([^}]+)\} from "@letternerd\/sdk[^"]*"/g)].flatMap((match) =>
          match[1]!.split(",").map((name) => name.replace(/^\s*type\s+/, "").trim()),
        ),
      ),
    ];
  }

  it("only imports symbols the SDK's source really exports", () => {
    // Vitest runs with the package as its cwd.
    const sdkSrc = resolve(process.cwd(), "../sdk/src");
    const source = readdirSync(sdkSrc)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFileSync(join(sdkSrc, file), "utf8"))
      .join("\n");

    const names = importedNames();
    expect(names.length).toBeGreaterThan(10);

    for (const name of names) {
      const declared = new RegExp(
        // Declared there, or re-exported by name in the entry point's list.
        `export (?:async )?(?:function|const|class|interface|type) ${name}\\b|^\\s{2}${name},$`,
        "m",
      );
      expect(source, `@letternerd/sdk does not export ${name}`).toMatch(declared);
    }
  });

  it("imports the SDK from its published name and nothing private", () => {
    for (const file of buildInstallPlan(VALUES).files) {
      expect(file.contents, `${file.path} imports a workspace package`).not.toMatch(
        /from "@cms\//,
      );
    }
  });
});

/**
 * The copy in the SDK, kept honest.
 *
 * `npx @letternerd/sdk init` cannot import this module — the SDK is published
 * and this package is private, so the dependency would be unresolvable on a
 * customer's machine — and it needs a fallback for the case where there is no
 * studio to reach. So the generator is mirrored there, and this is the test
 * that makes a copy safe rather than merely convenient: the two regions are
 * compared byte for byte, and the build fails the moment they disagree.
 *
 * Without it the drift would be silent in the worst way. The studio guide and
 * the fetched plan would stay correct, an offline `init` would quietly write
 * something else, and the discrepancy would surface as a broken build in a
 * repository nobody here can see.
 */
describe("the SDK's mirrored copy", () => {
  const BEGIN = "/* --- BEGIN SHARED GENERATOR";
  const END = "/* --- END SHARED GENERATOR";

  function sharedRegion(path: string): string {
    const source = readFileSync(path, "utf8");
    const start = source.indexOf(BEGIN);
    const end = source.indexOf(END);
    expect(start, `${path} has no BEGIN SHARED GENERATOR marker`).toBeGreaterThan(-1);
    expect(end, `${path} has no END SHARED GENERATOR marker`).toBeGreaterThan(start);
    // From the end of the marker comment, so each file may explain itself.
    return source.slice(source.indexOf("*/", start) + 2, end);
  }

  it("is byte-identical to the generator here", () => {
    const mine = sharedRegion(resolve(process.cwd(), "src/install.ts"));
    const theirs = sharedRegion(resolve(process.cwd(), "../sdk/src/cli/snippets.ts"));
    expect(mine.length).toBeGreaterThan(1000);
    expect(theirs).toBe(mine);
  });

  /**
   * The region can only be copied because it depends on nothing. A `zod` or a
   * `@cms/*` import here would either be unresolvable in a published bundle or
   * would drag the database layer into it, and the copy would stop compiling
   * on the far side rather than here.
   */
  it("depends on nothing a published package could not resolve", () => {
    const mirror = readFileSync(resolve(process.cwd(), "../sdk/src/cli/snippets.ts"), "utf8");
    expect(mirror).not.toMatch(/from "@cms\//);
    expect(mirror).not.toMatch(/from "(zod|drizzle-orm|node:[a-z]+)"/);
  });
});
