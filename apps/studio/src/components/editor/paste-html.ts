/**
 * Pasted HTML, turned into markdown.
 *
 * Copy a passage out of a Google Doc, a Notion page or a published article and
 * the clipboard carries two flavours: `text/plain`, which has lost the
 * headings and the links, and `text/html`, which has kept them inside a
 * thicket of `<span style="…">`. Pasting the first throws away structure the
 * author will now retype; pasting the second dumps markup into a markdown
 * file. Neither is what they meant, so the HTML is walked and re-emitted as
 * the markdown that means the same thing.
 *
 * Written by hand over `DOMParser` rather than pulled in from a library. The
 * job is small — headings, emphasis, links, lists, code, quotes and tables —
 * and a general-purpose converter would add a dependency, a bundle and a
 * second set of opinions about markdown flavour to reconcile with the
 * pipeline's own (`remark-gfm` plus directives).
 *
 * The parsing is inert. `DOMParser.parseFromString(html, "text/html")` builds
 * a detached document with no browsing context: scripts do not run, `src`
 * attributes are not fetched, and nothing here reads anything back out of a
 * live DOM. Only text is ever taken from it.
 */

/** Elements whose content is a block of its own rather than part of a line. */
const BLOCK = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6",
  "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE",
  "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** Never contributes text: script and style content is not prose. */
const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "SVG", "IFRAME"]);

function collapse(text: string): string {
  // HTML whitespace semantics: any run of whitespace in the source is one
  // space on screen, and a markdown file should say the same thing.
  // A non-breaking space is a space here: word processors emit runs of them
  // for indentation, and markdown has no use for the distinction.
  return text.replace(/ /g, " ").replace(/[\t\n\r ]+/g, " ");
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function safeHref(value: string | null): string | null {
  if (!value) return null;
  const href = value.trim();
  if (href.length === 0) return null;
  // A `javascript:` or `data:` target is never something an author meant to
  // paste into prose, and markdown-ing it would carry it into the document.
  if (/^(javascript|data|vbscript):/i.test(href)) return null;
  return href;
}

/** Emphasis around a run that is only whitespace produces literal asterisks. */
function wrapInline(inner: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match || match[2]!.length === 0) return inner;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function inlineChildren(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    out += inline(child);
  });
  return out;
}

function inline(node: Node): string {
  if (node.nodeType === 3) return collapse(node.textContent ?? "");
  if (!isElement(node)) return "";
  if (DROP.has(node.tagName)) return "";

  switch (node.tagName) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B":
      return wrapInline(inlineChildren(node), "**");
    case "EM":
    case "I":
      return wrapInline(inlineChildren(node), "*");
    case "DEL":
    case "S":
    case "STRIKE":
      return wrapInline(inlineChildren(node), "~~");
    case "CODE":
    case "KBD":
    case "SAMP": {
      const text = collapse(node.textContent ?? "");
      if (text.trim().length === 0) return text;
      // A span containing a backtick needs a longer fence than the content.
      const longest = /`+/g.exec(text)?.[0]?.length ?? 0;
      const fence = "`".repeat(longest + 1);
      return `${fence}${text}${fence}`;
    }
    case "A": {
      const href = safeHref(node.getAttribute("href"));
      const label = inlineChildren(node);
      if (!href || label.trim().length === 0) return label;
      // An anchor whose text already is its target reads better bare.
      if (label.trim() === href) return href;
      return `[${label.trim()}](${href})`;
    }
    case "IMG": {
      const src = safeHref(node.getAttribute("src"));
      const alt = (node.getAttribute("alt") ?? "").trim();
      return src ? `![${alt}](${src})` : "";
    }
    default:
      return inlineChildren(node);
  }
}

/** Trims a produced inline run and drops the soft line breaks inside it. */
function line(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function listBlock(node: Element, depth: number): string {
  const ordered = node.tagName === "OL";
  const start = Number.parseInt(node.getAttribute("start") ?? "1", 10);
  let index = Number.isFinite(start) ? start : 1;
  const indent = "  ".repeat(depth);
  let out = "";

  Array.from(node.children).forEach((child) => {
    if (child.tagName !== "LI") return;

    // A nested list is a child of the item, not part of its text, so it is
    // pulled out first and rendered underneath at one more level of indent.
    const nested: Element[] = [];
    let text = "";
    child.childNodes.forEach((grandchild) => {
      if (isElement(grandchild) && (grandchild.tagName === "UL" || grandchild.tagName === "OL")) {
        nested.push(grandchild);
      } else {
        text += inline(grandchild);
      }
    });

    const marker = ordered ? `${index}. ` : "- ";
    index += 1;
    out += `${indent}${marker}${line(text)}\n`;
    for (const list of nested) out += listBlock(list, depth + 1);
  });

  return out;
}

function tableBlock(node: Element): string {
  const rows = Array.from(node.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const cells = rows.map((row) =>
    Array.from(row.children)
      .filter((cell) => cell.tagName === "TD" || cell.tagName === "TH")
      // A pipe inside a cell would end the cell, so it is escaped.
      .map((cell) => line(inlineChildren(cell)).replace(/\|/g, "\\|")),
  );

  const width = Math.max(...cells.map((row) => row.length));
  if (width === 0) return "";

  const pad = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;

  const [header, ...body] = cells;
  const divider = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;

  return [pad(header ?? []), divider, ...body.map(pad)].join("\n");
}

function blocks(node: Node): string[] {
  if (node.nodeType === 3) {
    const text = line(collapse(node.textContent ?? ""));
    return text.length > 0 ? [text] : [];
  }
  if (!isElement(node) || DROP.has(node.tagName)) return [];

  switch (node.tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const text = line(inlineChildren(node));
      const depth = Number.parseInt(node.tagName.slice(1), 10);
      return text.length > 0 ? [`${"#".repeat(depth)} ${text}`] : [];
    }

    case "P": {
      // Paragraphs keep their hard breaks: a `<br>` inside one is a line
      // break the author put there, and markdown spells it with a backslash.
      const text = inlineChildren(node)
        .split("\n")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .join("\\\n");
      return text.length > 0 ? [text] : [];
    }

    case "PRE": {
      const text = (node.textContent ?? "").replace(/\n+$/, "");
      if (text.trim().length === 0) return [];
      const code = node.querySelector("code");
      const language =
        /(?:language|lang)-([\w+#-]+)/.exec(
          `${code?.className ?? ""} ${node.className}`,
        )?.[1] ?? "";
      // Long enough to survive a backtick run inside the pasted code.
      const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(longest + 1);
      return [`${fence}${language}\n${text}\n${fence}`];
    }

    case "BLOCKQUOTE": {
      const inner = children(node);
      if (inner.length === 0) return [];
      return [
        inner
          .join("\n\n")
          .split("\n")
          .map((part) => (part.length > 0 ? `> ${part}` : ">"))
          .join("\n"),
      ];
    }

    case "UL":
    case "OL": {
      const list = listBlock(node, 0).replace(/\n+$/, "");
      return list.length > 0 ? [list] : [];
    }

    case "TABLE": {
      const table = tableBlock(node);
      return table.length > 0 ? [table] : [];
    }

    case "HR":
      return ["---"];

    case "FIGCAPTION": {
      const text = line(inlineChildren(node));
      return text.length > 0 ? [`*${text}*`] : [];
    }

    default: {
      if (BLOCK.has(node.tagName)) return children(node);

      // An inline element at block level — a bare `<span>` or `<a>` between
      // paragraphs — is a paragraph of its own.
      const text = line(inline(node));
      return text.length > 0 ? [text] : [];
    }
  }
}

function children(node: Node): string[] {
  const out: string[] = [];
  let run = "";

  node.childNodes.forEach((child) => {
    const isBlockChild = isElement(child) && (BLOCK.has(child.tagName) || child.tagName === "HR");
    if (isBlockChild) {
      // Flush whatever inline text has accumulated before the block starts,
      // so `text <p>para</p>` does not glue the two together.
      const pending = line(run);
      if (pending.length > 0) out.push(pending);
      run = "";
      out.push(...blocks(child));
      return;
    }
    run += inline(child);
  });

  const pending = line(run);
  if (pending.length > 0) out.push(pending);
  return out;
}

/**
 * Convert an HTML fragment to markdown, or return `null` when there is nothing
 * structural to keep — in which case the caller should paste the plain text
 * flavour unchanged rather than a round-tripped copy of it.
 */
export function htmlToMarkdown(html: string): string | null {
  if (typeof DOMParser === "undefined") return null;

  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }

  const body = parsed.body;
  if (!body) return null;

  const markdown = children(body)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown.length > 0 ? markdown : null;
}

/**
 * Does this HTML carry anything markdown would preserve?
 *
 * Copying from a plain-text field, a terminal or another code editor still
 * puts a `text/html` flavour on the clipboard — usually a `<span>` or a `<pre>`
 * wrapping the same characters. Converting that is at best a no-op and at
 * worst mangles indentation, so the conversion only runs when the markup
 * contains an element that markdown would actually represent.
 */
export function hasStructuralMarkup(html: string): boolean {
  return /<(h[1-6]|strong|b|em|i|del|s|a|img|ul|ol|li|blockquote|table|code|pre|hr|p|div|br)\b/i.test(
    html,
  );
}
