import type { SeoSite } from "../types";
import { absoluteUrl } from "../url";

/**
 * robots.txt, served from the consuming site's root.
 *
 * The `Sitemap:` line is the only place in this file where the origin matters,
 * and it is absolute for a reason the spec is explicit about: a `Sitemap`
 * directive must give a full URL, and it is the one directive that is read
 * regardless of which user-agent group it sits in.
 */

/**
 * The crawlers that feed answer engines and training corpora, by the exact
 * token each one matches on.
 *
 * They are listed individually rather than collapsed into a wildcard because
 * robots.txt has no wildcard for "AI" — a group only ever matches the literal
 * product token — and because the list is a statement a site owner reviews.
 * Grouped by operator so that a change at one vendor is one edit here.
 */
export const AI_CRAWLER_USER_AGENTS = [
  // OpenAI: training, search index, and live user-initiated fetches.
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic.
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  // Perplexity.
  "PerplexityBot",
  "Perplexity-User",
  // Google's AI training opt-out, which is separate from Googlebot and does
  // not affect search indexing either way.
  "Google-Extended",
  // Common Crawl, which several models are trained from downstream.
  "CCBot",
  // ByteDance, Amazon, Apple's training opt-out, Meta.
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "meta-externalagent",
] as const;

export interface RobotsOptions {
  /**
   * `"allow"` writes an explicit `Allow: /` group for each AI crawler;
   * `"block"` writes an explicit `Disallow: /`.
   */
  aiCrawlers?: "allow" | "block";
  /** Where the sitemap lives on the consuming site. */
  sitemapPath?: string;
  /** Extra paths to keep every crawler out of, e.g. `/api/`, `/preview/`. */
  disallow?: string[];
}

export function buildRobotsTxt(site: SeoSite, opts: RobotsOptions = {}): string {
  const { aiCrawlers = "allow", sitemapPath = "/sitemap.xml", disallow = [] } = opts;

  const lines: string[] = ["User-agent: *", "Allow: /"];
  for (const path of disallow) lines.push(`Disallow: ${path}`);

  lines.push("");
  lines.push(
    aiCrawlers === "allow"
      ? "# Answer engines and AI crawlers: explicitly allowed."
      : "# Answer engines and AI crawlers: explicitly blocked.",
  );

  if (aiCrawlers === "allow") {
    // An explicit Allow is not the no-op it looks like. Several of these
    // crawlers are documented as reading their own group and nothing else, and
    // the operators of the rest treat a named group as a deliberate signal
    // rather than an omission — which is the whole point when the goal is to
    // be cited by an answer engine rather than merely indexed by a search one.
    // It also states the site's position where a reader can see it, instead of
    // leaving it to be inferred from silence.
    lines.push("# Naming each agent is a positive signal, not a formality: it states");
    lines.push("# a position an omission would leave to inference.");
  }

  for (const agent of AI_CRAWLER_USER_AGENTS) {
    lines.push("");
    lines.push(`User-agent: ${agent}`);
    lines.push(aiCrawlers === "allow" ? "Allow: /" : "Disallow: /");
  }

  lines.push("");
  lines.push(`Sitemap: ${absoluteUrl(site, sitemapPath)}`);

  const extra = site.robotsExtra?.trim();
  if (extra) {
    lines.push("");
    lines.push(extra);
  }

  return `${lines.join("\n")}\n`;
}
