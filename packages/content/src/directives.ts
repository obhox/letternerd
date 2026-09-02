/**
 * Authoring directives, turned into markup and into structured data at once.
 *
 * Every directive here exists because an answer engine needs the shape, not
 * because a writer wanted a box with a border. `:::tldr` and `:::takeaways`
 * become the elements the Speakable JSON-LD selects on, `:::faq` becomes the
 * FAQPage source, `:::howto` becomes the HowTo source. That is why the class
 * names are load-bearing and why extraction happens in the same pass as
 * rendering: markup and structured data that are produced separately drift,
 * and mismatched FAQ markup is the usual reason a site loses its rich result.
 */

import type { ElementContent, Properties } from "hast";
import { toString } from "mdast-util-to-string";
import type { Heading, List, ListItem, Root, RootContent } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { resolveEmbed } from "./embeds";
import { applyElement, element, type BlockChild } from "./mdast-html";
import type { HowToBlock, LintFinding } from "./types";

/**
 * Directive nodes, described structurally.
 *
 * `mdast-util-directive` declares these on mdast's content map, but this
 * package only depends on `remark-directive`, and narrowing a union that a
 * transitive augmentation may or may not have contributed is a fragile thing
 * to build on. A local shape and a guard cost three lines and cannot break.
 */
export interface DirectiveNode {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  children: RootContent[];
  data?: {
    directiveLabel?: boolean;
    hName?: string;
    hProperties?: Properties;
    hChildren?: ElementContent[];
  };
  position?: RootContent["position"];
}

export function isDirective(node: unknown): node is DirectiveNode {
  if (typeof node !== "object" || node === null) return false;
  const type = (node as { type?: unknown }).type;
  return (
    type === "containerDirective" || type === "leafDirective" || type === "textDirective"
  );
}

/** Everything the directive pass hands to the rest of the pipeline. */
export interface DirectiveHarvest {
  tldr: string | null;
  keyTakeaways: string[];
  /** Questions in document order; `index` is the `data-cms-qa` marker. */
  questions: { question: string; index: number; kind: string }[];
  howtos: HowToBlock[];
  findings: LintFinding[];
}

export function emptyHarvest(): DirectiveHarvest {
  return { tldr: null, keyTakeaways: [], questions: [], howtos: [], findings: [] };
}

function positionOf(node: { position?: RootContent["position"] }): Pick<
  LintFinding,
  "line" | "column"
> {
  const start = node.position?.start;
  return start ? { line: start.line, column: start.column } : {};
}

function isLabel(node: RootContent): boolean {
  return node.type === "paragraph" && node.data?.directiveLabel === true;
}

export function transformDirectives(tree: Root, harvest: DirectiveHarvest): void {
  let questionCounter = 0;

  visit(tree, (node, index, parent) => {
    if (!isDirective(node)) return;

    switch (node.name) {
      case "tldr":
        return tldr(node, harvest);
      case "takeaways":
        return takeaways(node, harvest);
      case "faq":
        questionCounter = faq(node, harvest, questionCounter);
        return;
      case "howto":
        return howto(node, harvest);
      case "embed":
        return embed(node, harvest);
      default:
        break;
    }

    // An unrecognised directive is almost always a typo in a name we do
    // support. Dropping the content would lose the writer's prose; rendering a
    // stray `<div>` would leak our internal vocabulary into the page. Unwrap it
    // and say so, then re-visit the same index so directives nested inside it
    // are still handled.
    harvest.findings.push({
      rule: "unknown-directive",
      severity: "warning",
      message: `Unknown directive ":${node.name}". Its content was kept but the directive was ignored.`,
      ...positionOf(node),
    });
    if (parent && typeof index === "number") {
      parent.children.splice(index, 1, ...(node.children as typeof parent.children));
      return [SKIP, index];
    }
    return;
  });
}

function tldr(node: DirectiveNode, harvest: DirectiveHarvest): void {
  applyElement(node, "div", { className: ["cms-tldr"] });
  const text = toString(node as unknown as RootContent).trim();
  // First one wins. A second `:::tldr` is an authoring mistake, and silently
  // preferring the later one would change what Speakable reads out depending on
  // where in the document the duplicate landed.
  if (text.length > 0 && harvest.tldr === null) harvest.tldr = text;
}

function takeaways(node: DirectiveNode, harvest: DirectiveHarvest): void {
  const list = node.children.find((child): child is List => child.type === "list");
  if (!list) {
    applyElement(node, "div", { className: ["cms-takeaways"] });
    harvest.findings.push({
      rule: "unknown-directive",
      severity: "warning",
      message: ":::takeaways contains no list, so no key takeaways were extracted.",
      ...positionOf(node),
    });
    return;
  }

  // The directive *becomes* the list rather than wrapping it: the Speakable
  // selector is `.cms-takeaways li`, and a `<div class="cms-takeaways"><ul>`
  // would still match, but a bare `<ul class="cms-takeaways">` is the markup
  // the schema documents and the one a consuming site will style.
  applyElement(node, "ul", { className: ["cms-takeaways"] });
  node.children = list.children;
  for (const item of list.children) {
    const text = toString(item).trim();
    if (text.length > 0) harvest.keyTakeaways.push(text);
  }
}

function faq(node: DirectiveNode, harvest: DirectiveHarvest, counter: number): number {
  applyElement(node, "section", { className: ["cms-faq"] });

  const intro: RootContent[] = [];
  const items: BlockChild[] = [];
  let current: { heading: Heading; answer: RootContent[] } | undefined;

  const flush = () => {
    if (!current) return;
    const index = counter++;
    applyElement(current.heading, undefined, {
      className: ["cms-faq__question"],
      "data-cms-qa": String(index),
    });
    harvest.questions.push({
      question: toString(current.heading).trim(),
      index,
      kind: "faq",
    });
    items.push(
      element("div", { className: ["cms-faq__item"] }, [
        current.heading,
        element(
          "div",
          { className: ["cms-faq__answer"], "data-cms-qa": String(index) },
          current.answer as BlockChild[],
        ),
      ]),
    );
    current = undefined;
  };

  for (const child of node.children) {
    if (child.type === "heading") {
      flush();
      current = { heading: child, answer: [] };
    } else if (current) {
      current.answer.push(child);
    } else if (!isLabel(child)) {
      intro.push(child);
    }
  }
  flush();

  node.children = [...intro, ...(items as unknown as RootContent[])];
  return counter;
}

function howto(node: DirectiveNode, harvest: DirectiveHarvest): void {
  applyElement(node, "section", { className: ["cms-howto"] });

  const before: RootContent[] = [];
  const stepItems: ListItem[] = [];
  const steps: { text: string }[] = [];
  let name: string | null = null;

  for (const child of node.children) {
    if (isLabel(child)) {
      name = toString(child).trim() || null;
      applyElement(child, "p", { className: ["cms-howto__name"] });
      before.push(child);
      continue;
    }

    // A step is written `::step[Do the thing]` when it is one line and
    // `:::step` when it needs paragraphs of its own. Accepting both means an
    // author never has to know which form the parser saw.
    if (isDirective(child) && child.name === "step") {
      const content: BlockChild[] =
        child.type === "leafDirective" || child.type === "textDirective"
          ? [{ type: "paragraph", children: child.children as never }]
          : (child.children as BlockChild[]);
      const position = stepItems.length + 1;
      stepItems.push({
        type: "listItem",
        spread: false,
        data: {
          hName: "li",
          hProperties: { className: ["cms-howto__step"], "data-step": String(position) },
        },
        children: content,
      });
      steps.push({ text: toString(child).trim() });
      continue;
    }

    before.push(child);
  }

  if (stepItems.length === 0) {
    harvest.findings.push({
      rule: "unknown-directive",
      severity: "warning",
      message: ":::howto contains no ::step children, so no steps were extracted.",
      ...positionOf(node),
    });
    node.children = before;
    return;
  }

  const list: List = {
    type: "list",
    ordered: true,
    spread: false,
    data: { hName: "ol", hProperties: { className: ["cms-howto__steps"] } },
    children: stepItems,
  };

  node.children = [...before, list];
  harvest.howtos.push({ name, steps });
}

function embed(node: DirectiveNode, harvest: DirectiveHarvest): void {
  const url = node.attributes?.url ?? undefined;
  const info = url ? resolveEmbed(url) : undefined;

  if (!info) {
    harvest.findings.push({
      rule: "embed-unsupported",
      severity: "warning",
      message: url
        ? `No embed provider matched "${url}". It was rendered as a plain link.`
        : "::embed is missing a url attribute.",
      ...positionOf(node),
    });
    applyElement(node, url ? "p" : "div", { className: ["cms-embed", "cms-embed--plain"] });
    if (url) {
      (node.data ??= {}).hChildren = [
        {
          type: "element",
          tagName: "a",
          properties: { href: url, rel: ["nofollow", "noopener"] },
          children: [{ type: "text", value: toString(node as unknown as RootContent) || url }],
        },
      ];
    }
    return;
  }

  const label = toString(node as unknown as RootContent).trim() || info.title;

  applyElement(node, "div", {
    className: ["cms-embed"],
    "data-provider": info.provider,
    "data-embed-id": info.id,
    "data-embed-url": info.watchUrl,
  });
  (node.data ??= {}).hChildren = [
    {
      type: "element",
      tagName: "img",
      properties: {
        className: ["cms-embed__poster"],
        src: info.posterUrl,
        // Decorative: the button carries the accessible name, and a poster
        // described twice is a screen-reader annoyance, not an aid.
        alt: "",
        width: info.posterWidth,
        height: info.posterHeight,
        loading: "lazy",
        decoding: "async",
      },
      children: [],
    },
    {
      type: "element",
      tagName: "button",
      properties: {
        className: ["cms-embed__play"],
        type: "button",
        ariaLabel: label,
      },
      children: [{ type: "text", value: label }],
    },
  ];
}
