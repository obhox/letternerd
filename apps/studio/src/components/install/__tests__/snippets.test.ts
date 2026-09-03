import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiUrl,
  blogAppDir,
  clientSnippet,
  envSnippet,
  installSnippet,
  KEY_PLACEHOLDER,
  legacySnippet,
  markdownRewriteSnippet,
  markdownRouteSnippet,
  postPageSnippet,
  postUrl,
  routeSnippets,
  verificationChecks,
  webhookRouteSnippet,
  type InstallValues,
} from "../snippets";

/**
 * The point of this page is that every block is already filled in. A snippet
 * that quietly keeps `https://studio.example.com` or `/blog` looks completely
 * correct and fails on the reader's machine, which is the failure mode worth a
 * test: nothing about it is visible in review.
 *
 * The site here deliberately uses neither default — a non-`/blog` base path and
 * a non-`en` locale — so a substitution that was never wired reads as an
 * obvious mismatch rather than coinciding with the fixture.
 */
const VALUES: InstallValues = {
  siteName: "Spendtab",
  studioOrigin: "https://studio.spendtab.com",
  baseUrl: "https://spendtab.com",
  blogBasePath: "/insights",
  locale: "en-GB",
  sampleSlug: "cash-flow-basics",
};

describe("derived values", () => {
  it("puts the API under /api/v1 on the studio origin", () => {
    expect(apiUrl(VALUES)).toBe("https://studio.spendtab.com/api/v1");
  });

  it("does not double a slash when the studio origin has a trailing one", () => {
    expect(apiUrl({ studioOrigin: "https://studio.spendtab.com/" })).toBe(
      "https://studio.spendtab.com/api/v1",
    );
  });

  it("maps the blog base path onto its app-router folder", () => {
    expect(blogAppDir("/insights")).toBe("app/insights");
    // A blog at the root is a real configuration, and `app/` is where it goes.
    expect(blogAppDir("/")).toBe("app");
  });

  it("builds the sample post URL from the site's own origin and path", () => {
    expect(postUrl(VALUES)).toBe("https://spendtab.com/insights/cash-flow-basics");
  });

  it("falls back to an obvious stand-in when nothing is published", () => {
    expect(postUrl({ ...VALUES, sampleSlug: null })).toBe(
      "https://spendtab.com/insights/your-post-slug",
    );
  });
});

describe("the snippets carry this site's values", () => {
  it("does not pretend the package is on a registry", () => {
    const snippet = installSnippet();
    expect(snippet).not.toMatch(/npm i(nstall)? @obhox\/cms-sdk\s*$/m);
    expect(snippet).toContain("@obhox/cms-sdk@workspace:*");
    expect(snippet).toContain("file:../cms/packages/sdk");
  });

  it("fills the env file with the real API URL and a loud key placeholder", () => {
    const snippet = envSnippet(VALUES);
    expect(snippet).toContain("CMS_API_URL=https://studio.spendtab.com/api/v1");
    expect(snippet).toContain(`CMS_API_KEY=${KEY_PLACEHOLDER}`);
    // A placeholder nobody could mistake for a key: that is the whole job.
    expect(KEY_PLACEHOLDER).toMatch(/^cms_sk_/);
    expect(KEY_PLACEHOLDER).toMatch(/PASTE/);
  });

  it("names the API URL beside the client's baseUrl", () => {
    expect(clientSnippet(VALUES)).toContain("https://studio.spendtab.com/api/v1");
    expect(clientSnippet(VALUES)).toContain("revalidate: 60");
  });

  it("puts the post page under the site's own blog folder", () => {
    const snippet = postPageSnippet(VALUES);
    expect(snippet).toContain("// app/insights/[slug]/page.tsx");
    expect(snippet).not.toContain("app/blog/[slug]/page.tsx");
    // The breadcrumb reads the path back from the API rather than hard-coding
    // it, which is the SDK's own rule about who owns a URL.
    expect(snippet).toContain("path: site.blogBasePath");
  });

  it("only imports symbols the SDK actually exports", () => {
    const everything = [
      postPageSnippet(VALUES),
      clientSnippet(VALUES),
      legacySnippet(VALUES),
      webhookRouteSnippet(VALUES).code,
      markdownRouteSnippet(VALUES).code,
      markdownRewriteSnippet(VALUES).code,
      ...routeSnippets(VALUES).map((file) => file.code),
    ].join("\n");

    const imported = new Set<string>();
    for (const match of everything.matchAll(/import \{([^}]+)\} from "@obhox\/cms-sdk[^"]*"/g)) {
      for (const name of match[1]!.split(",")) {
        imported.add(name.replace(/^\s*type\s+/, "").trim());
      }
    }

    expect([...imported].sort()).toEqual([
      "CmsImage",
      "JsonLd",
      "LegacyPost",
      "PostBody",
      "blogPostingLd",
      "breadcrumbLd",
      "cmsRedirects",
      "createBlogSitemapRoute",
      "createCmsClient",
      "createFeedRoute",
      "createLegacyApi",
      "createLlmsTxtRoute",
      "createPostMarkdownRoute",
      "createRevalidateWebhookRoute",
      "createRobotsRoute",
      "faqLd",
      "postMetadata",
      "speakableLd",
      "toSeoDocument",
    ]);
  });

  /**
   * The curated list above says what was checked. This says it is still true.
   *
   * A guide with an import that does not resolve is worse than no guide: it
   * looks authoritative and fails at build time on someone else's machine. So
   * the names are checked against the SDK's own source rather than against
   * anyone's memory of it — rename an export in `packages/sdk` and this fails
   * here, in CI, instead of there, in a consuming site.
   */
  it("imports names the SDK's source really exports", () => {
    // Vitest runs with the app as its cwd; `import.meta.url` is served over
    // http in this environment and is not a filesystem path.
    const sdkSrc = resolve(process.cwd(), "../../packages/sdk/src");
    const source = readdirSync(sdkSrc)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFileSync(join(sdkSrc, file), "utf8"))
      .join("\n");

    const names = [
      ...new Set(
        [
          postPageSnippet(VALUES),
          clientSnippet(VALUES),
          legacySnippet(VALUES),
          webhookRouteSnippet(VALUES).code,
          markdownRouteSnippet(VALUES).code,
          markdownRewriteSnippet(VALUES).code,
          ...routeSnippets(VALUES).map((file) => file.code),
        ]
          .join("\n")
          .matchAll(/import \{([^}]+)\} from "@obhox\/cms-sdk[^"]*"/g),
      ),
    ].flatMap((match) => match[1]!.split(",").map((name) => name.replace(/^\s*type\s+/, "").trim()));

    for (const name of names) {
      const declared = new RegExp(
        // Declared here, or re-exported by name in the entry point's list.
        `export (?:async )?(?:function|const|class|interface|type) ${name}\\b|^\\s{2}${name},$`,
        "m",
      );
      expect(source, `@obhox/cms-sdk does not export ${name}`).toMatch(declared);
    }
  });

  it("keeps the four artifact routes one line each, on the site's own origin", () => {
    const files = routeSnippets(VALUES);
    expect(files.map((file) => file.path)).toEqual([
      "app/sitemap.xml/route.ts",
      "app/robots.txt/route.ts",
      "app/rss.xml/route.ts",
      "app/llms.txt/route.ts",
    ]);
    for (const file of files) {
      expect(file.serves.startsWith("https://spendtab.com/")).toBe(true);
      expect(file.code).toMatch(/^export const GET = create/m);
    }
  });

  it("rewrites the .md alternate from the site's own blog path", () => {
    expect(markdownRewriteSnippet(VALUES).code).toContain(
      'source: "/insights/:slug.md", destination: "/api/cms/markdown/:slug"',
    );
  });

  it("reads the webhook secret from CMS_WEBHOOK_SECRET", () => {
    const webhook = webhookRouteSnippet(VALUES);
    expect(webhook.code).toContain("process.env.CMS_WEBHOOK_SECRET!");
    expect(webhook.serves).toBe("https://spendtab.com/api/cms/revalidate");
  });

  it("defaults the legacy byline to this site's name", () => {
    expect(legacySnippet(VALUES)).toContain('defaultAuthor: "Spendtab"');
  });
});

describe("the verification commands", () => {
  const checks = verificationChecks(VALUES);

  it("addresses the consuming domain, never the studio", () => {
    for (const check of checks) {
      // The key check is the one exception: it calls the CMS API on purpose.
      if (check.id === "key") continue;
      expect(check.command).not.toContain("studio.spendtab.com");
      expect(check.command).toContain("spendtab.com");
    }
  });

  it("checks all four artifacts and the markdown alternate", () => {
    const artifacts = checks.find((check) => check.id === "artifacts")!;
    for (const path of ["/sitemap.xml", "/robots.txt", "/rss.xml", "/llms.txt"]) {
      expect(artifacts.command).toContain(path);
    }
    expect(checks.find((check) => check.id === "markdown")!.command).toContain(
      "https://spendtab.com/insights/cash-flow-basics.md",
    );
  });

  it("proves content is server-rendered and reachable by a crawler", () => {
    expect(checks.find((check) => check.id === "server-rendered")!.command).toContain(
      "grep -c '<article'",
    );
    expect(checks.find((check) => check.id === "crawler")!.command).toContain('curl -sA "GPTBot"');
  });

  it("says what every failure means, not just what to run", () => {
    for (const check of checks) {
      expect(check.failure.length).toBeGreaterThan(80);
      expect(check.expect.length).toBeGreaterThan(0);
    }
  });
});
