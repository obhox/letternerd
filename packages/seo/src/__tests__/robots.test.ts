import { describe, expect, it } from "vitest";
import { AI_CRAWLER_USER_AGENTS, buildRobotsTxt } from "../index.js";
import { site } from "./fixtures.js";

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

  it("takes a sitemap path for a site that serves an index instead", () => {
    expect(buildRobotsTxt(site, { sitemapPath: "/sitemap-index.xml" })).toContain(
      "Sitemap: https://spendtab.com/sitemap-index.xml",
    );
  });
});
