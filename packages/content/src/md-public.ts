/**
 * `mdPublic` — the `/blog/<slug>.md` payload.
 *
 * This is what an LLM fetches instead of parsing our HTML, so it is not a copy
 * of the input. The input is full of things that only mean something inside
 * this CMS: `media://` ids that resolve nowhere else, relative links that
 * resolve against a page the fetcher does not have, and `:::` directives whose
 * semantics live in this package. Any of those reaching the endpoint turns a
 * clean document into one the reader has to guess at.
 *
 * So the directives are flattened into the ordinary markdown a human would have
 * written by hand, every URL is made absolute, and the public frontmatter is
 * prepended. It is built from an independent parse of the source rather than
 * from the render tree, because the render tree has already been rewritten into
 * things `mdast-util-to-markdown` has no handler for.
 */

import matter from "gray-matter";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Heading, List, ListItem, Paragraph, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import { unified } from "unified";
import { isDirective, type DirectiveNode } from "./directives.js";
import { mediaId, type MediaResolver } from "./media.js";
import type { RenderSiteContext } from "./types.js";

/**
 * GFM's serialiser extensions, borrowed from a processor rather than imported.
 *
 * `mdast-util-gfm` is not a direct dependency of this package, but
 * `remark-gfm` publishes exactly these extensions onto the processor it is
 * attached to. Reading them off a frozen processor gets the tables, strike-
 * through and footnotes serialising correctly without widening the dependency
 * surface — and guarantees the parser and the serialiser are the same version.
 */
const GFM_EXTENSIONS = (() => {
  const data = unified().use(remarkGfm).freeze().data() as Record<string, unknown>;
  const extensions = data["toMarkdownExtensions"];
  return (Array.isArray(extensions) ? extensions : []) as NonNullable<
    ToMarkdownOptions["extensions"]
  >;
})();

const SERIALIZE: ToMarkdownOptions = {
  extensions: GFM_EXTENSIONS,
  bullet: "-",
  emphasis: "_",
  strong: "*",
  fences: true,
  rule: "-",
};

function heading(depth: Heading["depth"], value: string): Heading {
  return { type: "heading", depth, children: [{ type: "text", value }] };
}

function paragraph(children: Paragraph["children"]): Paragraph {
  return { type: "paragraph", children };
}

export interface PublicMarkdownInput {
  /** An independent parse of the source markdown. Mutated in place. */
  tree: Root;
  site: RenderSiteContext;
  slug: string;
  resolveMedia?: MediaResolver | undefined;
  publicFrontmatter?: Record<string, unknown> | undefined;
}

export interface PublicMarkdownResult {
  markdown: string;
  /** FAQ answers as markdown, in document order — index-aligned with `qaBlocks`. */
  answers: string[];
}

export function buildPublicMarkdown(input: PublicMarkdownInput): PublicMarkdownResult {
  const answers: string[] = [];
  const base = documentUrl(input.site, input.slug);

  const children = flatten(input.tree.children, {
    answers,
    resolveMedia: input.resolveMedia,
  });
  const tree: Root = { type: "root", children };

  absolutise(tree, base, input.resolveMedia);

  const body = toMarkdown(tree, SERIALIZE).trimEnd();
  const frontmatter = input.publicFrontmatter;
  if (!frontmatter || Object.keys(frontmatter).length === 0) return { markdown: body, answers };

  return { markdown: matter.stringify(body, frontmatter), answers };
}

/** `https://site.example/blog/my-post` — what relative links resolve against. */
function documentUrl(site: RenderSiteContext, slug: string): URL {
  const path = `${site.blogBasePath.replace(/\/+$/, "")}/${slug}`;
  return new URL(path.startsWith("/") ? path : `/${path}`, site.baseUrl);
}

interface FlattenContext {
  answers: string[];
  resolveMedia?: MediaResolver | undefined;
}

function flatten(nodes: readonly RootContent[], ctx: FlattenContext): RootContent[] {
  const out: RootContent[] = [];

  for (const node of nodes) {
    // The source's own frontmatter never reaches the endpoint: `publicFrontmatter`
    // is the curated version, and shipping both would publish drafting notes.
    if (node.type === "yaml") continue;

    if (!isDirective(node)) {
      if ("children" in node && Array.isArray(node.children)) {
        node.children = flatten(node.children, ctx) as typeof node.children;
      }
      out.push(node);
      continue;
    }

    switch (node.name) {
      case "tldr":
        out.push(heading(2, "TL;DR"), ...flatten(node.children, ctx));
        break;
      case "takeaways":
        out.push(heading(2, "Key takeaways"), ...flatten(node.children, ctx));
        break;
      case "faq":
        out.push(...flattenFaq(node, ctx));
        break;
      case "howto":
        out.push(...flattenHowto(node, ctx));
        break;
      case "embed":
        out.push(...flattenEmbed(node));
        break;
      default:
        // Same call as the renderer makes: keep the prose, drop the wrapper.
        out.push(...flatten(node.children, ctx));
        break;
    }
  }

  return out;
}

function flattenFaq(node: DirectiveNode, ctx: FlattenContext): RootContent[] {
  const out: RootContent[] = [heading(2, "FAQ")];
  let pending: RootContent[] | undefined;

  const flush = () => {
    if (!pending) return;
    // Serialised here, one question at a time, so `qaBlocks[i].answerMd` is the
    // exact markdown that appears under that question in the public document —
    // an FAQ answer that differs between the two is the mismatch Google
    // penalises.
    ctx.answers.push(toMarkdown({ type: "root", children: pending }, SERIALIZE).trim());
    pending = undefined;
  };

  for (const child of flatten(node.children, ctx)) {
    if (child.type === "heading") {
      flush();
      // Questions are always H3 in the public document regardless of what the
      // author wrote, because the "FAQ" H2 above is generated here.
      out.push({ ...child, depth: 3 });
      pending = [];
      continue;
    }
    if (pending) pending.push(child);
    out.push(child);
  }
  flush();

  return out;
}

function flattenHowto(node: DirectiveNode, ctx: FlattenContext): RootContent[] {
  const before: RootContent[] = [];
  const items: ListItem[] = [];
  let name: string | null = null;

  for (const child of node.children) {
    if (child.type === "paragraph" && child.data?.directiveLabel === true) {
      name = child.children.length > 0 ? toMarkdown(child, SERIALIZE).trim() : null;
      continue;
    }
    if (isDirective(child) && child.name === "step") {
      const content =
        child.type === "containerDirective"
          ? flatten(child.children, ctx)
          : [paragraph(child.children as Paragraph["children"])];
      items.push({ type: "listItem", spread: false, children: content as ListItem["children"] });
      continue;
    }
    before.push(child);
  }

  const out: RootContent[] = [heading(2, name ?? "How to")];
  out.push(...flatten(before, ctx));
  if (items.length > 0) {
    const list: List = { type: "list", ordered: true, spread: false, children: items };
    out.push(list);
  }
  return out;
}

function flattenEmbed(node: DirectiveNode): RootContent[] {
  const url = node.attributes?.url;
  if (!url) return [];
  // A facade is a rendering concern. For a reader of the markdown the only
  // useful residue is where the video actually is.
  const label =
    node.children.length > 0
      ? toMarkdown(paragraph(node.children as Paragraph["children"]), SERIALIZE).trim()
      : "";
  return [
    paragraph([
      { type: "link", url, children: [{ type: "text", value: label || url }] },
    ]),
  ];
}

/**
 * Rewrite every URL so the document stands alone.
 *
 * `media://` becomes the CDN URL the site would have served, and anything
 * relative is resolved against the document's own address. A fetcher that saw
 * `](/pricing)` would otherwise resolve it against its own origin, which is how
 * a summariser ends up citing the wrong company's pricing page.
 */
function absolutise(tree: Root, base: URL, resolveMedia: MediaResolver | undefined): void {
  const rewrite = (url: string): string => {
    const id = mediaId(url);
    if (id !== undefined) return resolveMedia?.(id)?.src ?? url;
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  };

  const walk = (node: RootContent | Root): void => {
    if (node.type === "link" || node.type === "image" || node.type === "definition") {
      node.url = rewrite(node.url);
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };

  walk(tree);
}
