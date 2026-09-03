import { describe, expect, it } from "vitest";
import { AI_CRAWLER_USER_AGENTS, buildRobotsTxt } from "../index";
import { site } from "./fixtures";

describe("buildRobotsTxt", () => {
  it("opens the site to everything and points at the sitemap absolutely", () => {
    const txt = buildRobotsTxt(site);
    expect(txt.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
    expect(txt).toContain("Sitemap: https://spendtab.com/sitemap.xml");
  });

  it("names every AI crawler in both modes", () => {
    const allowed = buildRobotsTxt(site, { aiCrawlers: "allow" });
    const blocked = buildRobotsTxt(site, { aiCrawlers: "block" });

    for (const agent of AI_CRAWLER_USER_AGENTS) {
      expect(allowed).toContain(`User-agent: ${agent}\nAllow: /`);
      expect(blocked).toContain(`User-agent: ${agent}\nDisallow: /`);
    }
    expect(AI_CRAWLER_USER_AGENTS).toHaveLength(14);
  });

  it("covers the agents by name, not by hoping a wildcard matches", () => {
    const txt = buildRobotsTxt(site, { aiCrawlers: "block" });
    for (const agent of [
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-User",
      "Claude-SearchBot",
      "PerplexityBot",
      "Perplexity-User",
      "Google-Extended",
      "CCBot",
      "Bytespider",
      "Amazonbot",
      "Applebot-Extended",
      "meta-externalagent",
    ]) {
      expect(txt).toContain(`User-agent: ${agent}`);
    }
  });

  it("blocking the AI crawlers does not block anyone else", () => {
    const txt = buildRobotsTxt(site, { aiCrawlers: "block" });
    expect(txt).toContain("User-agent: *\nAllow: /");
    expect(txt).not.toContain("User-agent: *\nDisallow: /\n");
  });

  it("appends the site's own extra rules last", () => {
    const txt = buildRobotsTxt(site, { disallow: ["/preview/"] });
    expect(txt).toContain("User-agent: *\nAllow: /\nDisallow: /preview/");
    expect(txt.trimEnd().endsWith("Disallow: /internal/")).toBe(true);
  });

  it("cannot be handed a new directive through a disallow entry", () => {
    const txt = buildRobotsTxt(site, {
      disallow: ["/preview/\nUser-agent: Googlebot\r\nDisallow: /", "  /api/  ", "", " \r\n "],
    });

    // The injected group never becomes a line of its own.
    expect(txt).not.toMatch(/^User-agent: Googlebot$/m);
    expect(txt).not.toMatch(/^Disallow: \/$/m);
    // Blank entries vanish rather than becoming an empty `Disallow:`.
    expect(txt).not.toMatch(/^Disallow:\s*$/m);
    // What survives is one Disallow per non-blank entry, trimmed, in order.
    expect(txt).toContain(
      "User-agent: *\nAllow: /\nDisallow: /preview/User-agent: GooglebotDisallow: /\nDisallow: /api/\n\n",
    );
    expect(txt.match(/^Disallow: /gm)).toHaveLength(3);
  });

  it("takes a sitemap path for a site that serves an index instead", () => {
    expect(buildRobotsTxt(site, { sitemapPath: "/sitemap-index.xml" })).toContain(
      "Sitemap: https://spendtab.com/sitemap-index.xml",
    );
  });
});
