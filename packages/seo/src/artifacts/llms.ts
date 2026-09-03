import type { SeoDocument, SeoSite } from "../types";
import { canonicalUrlFor } from "../url";

/**
 * `llms.txt` and `llms-full.txt`, served from the consuming site's root.
 *
 * The convention is young and unratified, which is precisely why it is worth
 * emitting: it costs two static files, and it is the only place a site can
 * hand a model a clean, complete, markup-free copy of what it publishes
 * instead of hoping an HTML-to-text pass got it right. Both files use the
 * consuming origin for every link, like everything else here.
 */

/** The fields `llms.txt` reads. A full `SeoDocument` satisfies it. */
export type LlmsIndexEntry = Pick<
  SeoDocument,
  "slug" | "title" | "description" | "excerpt" | "category" | "canonicalUrlOverride"
>;

function siteHeader(site: SeoSite): string {
  const lines = [`# ${site.name}`, ""];

  const intro = site.llmsIntro?.trim();
  if (intro) {
    // A blockquote is what the convention uses for the one-paragraph summary,
    // and multi-line intros have to be quoted line by line to stay one.
    for (const line of intro.split("\n")) lines.push(`> ${line.trim()}`.trimEnd());
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/** The category grouping heading for entries that have no category. */
const UNCATEGORISED = "Other";

/**
 * A title as the text of a markdown link.
 *
 * Inside `[…](url)` a bracket or a parenthesis is structural: a title such as
 * "Read [this] (now)" would close the link text at the first `]`, and what
 * follows is then free-standing markdown — with the URL after it, a second
 * link the author never wrote. Those four characters are backslash-escaped,
 * and so is the backslash itself, or a title ending in `\` would escape the
 * closing bracket we add. Everything else is literal in link text.
 */
function linkText(title: string): string {
  return title.replace(/[\\[\]()]/g, "\\$&");
}

export function buildLlmsTxt(index: LlmsIndexEntry[], site: SeoSite): string {
  // Insertion order is the caller's order, so a caller that sorted by date or
  // by importance keeps that ordering inside each group. Grouping is by
  // category name because that is what a reader — human or otherwise — sees.
  const groups = new Map<string, LlmsIndexEntry[]>();
  for (const entry of index) {
    const key = entry.category?.name ?? UNCATEGORISED;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const lines = [siteHeader(site).trimEnd(), "", "## Blog", ""];

  for (const [category, entries] of groups) {
    lines.push(`### ${category}`, "");
    for (const entry of entries) {
      const url = canonicalUrlFor(site, entry);
      const summary = (entry.description ?? entry.excerpt ?? "").replace(/\s+/g, " ").trim();
      const text = linkText(entry.title);
      lines.push(summary ? `- [${text}](${url}): ${summary}` : `- [${text}](${url})`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/* --------------------------------------------------------- llms-full.txt -- */

/** YAML-safe scalar. Double quoting handles every character a title can hold. */
function yamlValue(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(doc: SeoDocument, site: SeoSite): string {
  const authors = doc.authors && doc.authors.length > 0 ? doc.authors : doc.author ? [doc.author] : [];

  const fields: string[] = [
    `title: ${yamlValue(doc.title)}`,
    `url: ${yamlValue(canonicalUrlFor(site, doc))}`,
  ];
  if (doc.publishedAt) fields.push(`date: ${yamlValue(doc.publishedAt)}`);
  if (doc.dateModified) fields.push(`updated: ${yamlValue(doc.dateModified)}`);
  if (authors.length > 0) {
    fields.push(`authors: [${authors.map((author) => yamlValue(author.name)).join(", ")}]`);
  }
  if (doc.category) fields.push(`category: ${yamlValue(doc.category.name)}`);
  if (doc.tags && doc.tags.length > 0) {
    fields.push(`tags: [${doc.tags.map((tag) => yamlValue(tag.name)).join(", ")}]`);
  }
  const summary = doc.description ?? doc.excerpt;
  if (summary) fields.push(`description: ${yamlValue(summary)}`);

  return fields.join("\n");
}

/**
 * A line of `---` on its own is a thematic break in markdown and the fence
 * that opens the next document's frontmatter in this file. Escaped, it is
 * still three dashes to a markdown renderer and nothing to a frontmatter
 * parser. Only the exact line is escaped: `----` and `- - -` are breaks too,
 * but neither is a fence, so neither can be mistaken for one.
 */
function escapeFence(body: string): string {
  return body
    .split("\n")
    .map((line) => (line.trim() === "---" ? "\\---" : line))
    .join("\n");
}

/**
 * One document's block: its frontmatter, then its markdown body.
 *
 * The opening `---` of the frontmatter is also the separator between
 * documents. The body is markdown, not plain text, so it can legitimately
 * contain a `---` thematic break of its own — and to a reader splitting this
 * file on fences, that line would end the article early and start a bogus
 * frontmatter block with the rest of the body inside it. Every such line is
 * escaped (see `escapeFence`), which keeps the fence unambiguous without
 * changing what the body renders as.
 */
function documentBlock(doc: SeoDocument, site: SeoSite): string {
  const body = escapeFence((doc.bodyText ?? doc.excerpt ?? doc.description ?? "").trim());
  return `---\n${frontmatter(doc, site)}\n---\n\n# ${doc.title}\n\n${body}\n\n`;
}

/**
 * The chunk sequence both public forms are built from.
 *
 * Having exactly one definition is the point: the streamed file and the string
 * are the same bytes because there is only one place that decides what those
 * bytes are.
 */
function* llmsFullTxtChunks(docs: SeoDocument[], site: SeoSite): Generator<string> {
  yield siteHeader(site);
  for (const doc of docs) yield documentBlock(doc, site);
}

export function buildLlmsFullTxt(docs: SeoDocument[], site: SeoSite): string {
  return [...llmsFullTxtChunks(docs, site)].join("");
}

/**
 * The same file, one chunk per document.
 *
 * `llms-full.txt` is every published article concatenated; on a site with a
 * few thousand posts it is tens of megabytes, and buffering it to hand to a
 * `Response` costs that much resident memory per request. The SDK pipes this
 * instead. It is an async generator rather than a sync one purely so the SDK
 * can adapt it to a `ReadableStream` without a wrapper — nothing here awaits.
 */
export async function* streamLlmsFullTxt(
  docs: SeoDocument[],
  site: SeoSite,
): AsyncGenerator<string> {
  for (const chunk of llmsFullTxtChunks(docs, site)) yield chunk;
}
