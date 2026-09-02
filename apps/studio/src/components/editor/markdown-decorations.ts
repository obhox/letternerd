import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Markdown, decorated in the source pane.
 *
 * The document an author types is plain markdown and stays plain markdown —
 * there is no parallel node tree, nothing is folded away, and every character
 * on screen is a character in the file. What changes is only how it is drawn:
 * a `## ` line is set at heading size, `**bold**` is bold, an `inline code`
 * span is monospaced on a tinted chip, a blockquote is indented behind a rule.
 * The markup itself is not hidden — hiding it makes a source editor lie about
 * where the caret is — it is recessed, so the prose reads first and the syntax
 * reads second.
 *
 * Two mechanisms, and the reason for each:
 *
 *   - Line decorations, for anything that changes the shape of a whole line:
 *     heading size, quote indent, code-block background. These have to be
 *     applied per line rather than per node, because one `Blockquote` node
 *     covers many lines and a `Decoration.mark` cannot set a line's box.
 *   - Mark decorations, for the inline spans — strong, emphasis, code, link
 *     text, and the syntax markers themselves.
 *
 * A `HighlightStyle` over the Lezer tags would be the conventional way to do
 * the second half, but `@lezer/highlight` — where `tags` lives — is not a
 * declared dependency of this app and is not resolvable from it, so the tag
 * vocabulary is not importable here. Walking the syntax tree by node name
 * costs one `iterate` per viewport change and buys something the tag route
 * could not do at all: the line-level decorations above, and different
 * treatments for a node and its markers, which share a tag.
 *
 * Everything is computed for the visible ranges only. A 5,000-line document
 * decorates the couple of hundred lines on screen.
 */

/** Node names whose whole line(s) take a class. */
const LINE_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-md-h1",
  ATXHeading2: "cm-md-h2",
  ATXHeading3: "cm-md-h3",
  ATXHeading4: "cm-md-h4",
  ATXHeading5: "cm-md-h5",
  ATXHeading6: "cm-md-h6",
  SetextHeading1: "cm-md-h1",
  SetextHeading2: "cm-md-h2",
  Blockquote: "cm-md-quote",
  FencedCode: "cm-md-codeblock",
  CodeBlock: "cm-md-codeblock",
  HorizontalRule: "cm-md-hr",
  Table: "cm-md-table",
};

/** Node names that become an inline span. */
const MARK_CLASSES: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  Strikethrough: "cm-md-strike",
  InlineCode: "cm-md-code",
  Link: "cm-md-link",
  Image: "cm-md-image",
  URL: "cm-md-url",
  Autolink: "cm-md-url",
  LinkTitle: "cm-md-url",
  CodeInfo: "cm-md-mark",
  HTMLTag: "cm-md-html",
  HTMLBlock: "cm-md-html",
  Comment: "cm-md-html",
  CommentBlock: "cm-md-html",
  // Comments inside a fenced code block, via the nested language's parser.
  LineComment: "cm-md-comment",
  BlockComment: "cm-md-comment",
  TaskMarker: "cm-md-mark",
};

/**
 * The syntax markers.
 *
 * Recessed rather than removed. An author needs to see that the `**` is there
 * to know that backspacing once will unbalance it.
 */
const MARKER_NODES = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "TableDelimiter",
]);

/**
 * The pipeline's authoring blocks, which the markdown parser does not know.
 *
 * `remark-directive` gives `:::tldr`, `:::faq`, `::step[]` and `::embed{}`
 * meaning at publish time, but to Lezer they are ordinary paragraph text and
 * would be drawn as prose. A line test is enough to set them apart, and it
 * matches the same anchoring the transform requires: the marker starts the
 * line, with only whitespace before it.
 */
const DIRECTIVE_LINE = /^\s{0,3}:{2,3}[A-Za-z[{\]]*/;

const lineDecoration = new Map<string, Decoration>();
function lineDeco(classes: string): Decoration {
  let deco = lineDecoration.get(classes);
  if (!deco) {
    deco = Decoration.line({ class: classes });
    lineDecoration.set(classes, deco);
  }
  return deco;
}

const markDecoration = new Map<string, Decoration>();
function markDeco(className: string): Decoration {
  let deco = markDecoration.get(className);
  if (!deco) {
    deco = Decoration.mark({ class: className });
    markDecoration.set(className, deco);
  }
  return deco;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const marks: Range<Decoration>[] = [];

  /**
   * One decoration per line, whatever it collects.
   *
   * A blockquote containing a heading would otherwise produce two line
   * decorations at the same position and two `class` applications; gathering
   * the names first keeps it to a single, predictable class list.
   */
  const lines = new Map<number, Set<string>>();
  function addLineClass(from: number, to: number, className: string): void {
    let position = from;
    while (position <= to) {
      const line = state.doc.lineAt(position);
      let set = lines.get(line.from);
      if (!set) {
        set = new Set<string>();
        lines.set(line.from, set);
      }
      set.add(className);
      if (line.to >= state.doc.length) break;
      position = line.to + 1;
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const lineClass = LINE_CLASSES[node.name];
        if (lineClass) {
          addLineClass(node.from, node.to, lineClass);
          if (node.name === "FencedCode" || node.name === "CodeBlock") {
            // Only the first and last line carry the rounded edge, so a block
            // reads as one slab rather than a stack of chips.
            addLineClass(node.from, node.from, "cm-md-codeblock-open");
            addLineClass(node.to, node.to, "cm-md-codeblock-close");
          }
        }

        if (MARKER_NODES.has(node.name)) {
          if (node.to > node.from) marks.push(markDeco("cm-md-mark").range(node.from, node.to));
          return;
        }

        const markClass = MARK_CLASSES[node.name];
        if (markClass && node.to > node.from) {
          marks.push(markDeco(markClass).range(node.from, node.to));
        }
      },
    });

    // The directive pass. Line-based, and deliberately separate from the tree
    // walk above, because there is no node to hang it on.
    let position = from;
    while (position <= to) {
      const line = state.doc.lineAt(position);
      if (DIRECTIVE_LINE.test(line.text)) addLineClass(line.from, line.from, "cm-md-directive");
      if (line.to >= state.doc.length) break;
      position = line.to + 1;
    }
  }

  const ranges: Range<Decoration>[] = [];
  for (const [from, classes] of lines) {
    ranges.push(lineDeco([...classes].join(" ")).range(from));
  }
  ranges.push(...marks);

  // `true` sorts. Line and mark decorations are produced in two passes and
  // arrive interleaved, and an unsorted set throws.
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate): void {
      // The tree identity check matters: the markdown parser finishes large
      // documents asynchronously, and without it the first screen of a long
      // post would keep whatever decorations the incomplete tree produced.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * The paint.
 *
 * Sizes are `em`-relative so the whole pane scales with the one font size set
 * on `.cm-content`, and every colour is a token — the studio's palette is
 * achromatic by design, so hierarchy here is size, weight and contrast only.
 */
const decorationTheme = EditorView.theme({
  ".cm-md-h1, .cm-md-h2, .cm-md-h3, .cm-md-h4, .cm-md-h5, .cm-md-h6": {
    fontWeight: "650",
    letterSpacing: "var(--tracking-tight)",
    color: "var(--color-ink)",
  },
  ".cm-md-h1": { fontSize: "1.7em", lineHeight: "1.3", marginTop: "0.4em" },
  ".cm-md-h2": { fontSize: "1.4em", lineHeight: "1.35", marginTop: "0.4em" },
  ".cm-md-h3": { fontSize: "1.18em", lineHeight: "1.4", marginTop: "0.3em" },
  ".cm-md-h4": { fontSize: "1.05em", lineHeight: "1.45" },
  ".cm-md-h5": { fontSize: "1em" },
  ".cm-md-h6": { fontSize: "1em", color: "var(--color-ink-secondary)" },

  ".cm-md-quote": {
    color: "var(--color-ink-secondary)",
    fontStyle: "italic",
    boxShadow: "inset 2px 0 0 0 var(--color-border-strong)",
  },

  ".cm-md-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    backgroundColor: "var(--color-surface-sunken)",
  },
  ".cm-md-codeblock-open": { borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)" },
  ".cm-md-codeblock-close": {
    borderBottomLeftRadius: "var(--radius)",
    borderBottomRightRadius: "var(--radius)",
  },

  ".cm-md-hr": { color: "var(--color-ink-faint)" },
  ".cm-md-table": { fontFamily: "var(--font-mono)", fontSize: "0.9em" },

  ".cm-md-directive": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    color: "var(--color-ink-secondary)",
    backgroundColor: "color-mix(in oklch, var(--color-muted) 55%, transparent)",
    borderRadius: "var(--radius-sm)",
  },

  ".cm-md-strong": { fontWeight: "700", color: "var(--color-ink)" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", color: "var(--color-ink-muted)" },
  ".cm-md-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: "var(--color-muted)",
    borderRadius: "var(--radius-sm)",
    padding: "0.1em 0.15em",
  },
  ".cm-md-link": {
    color: "var(--color-ink)",
    textDecoration: "underline",
    textUnderlineOffset: "0.18em",
    textDecorationColor: "var(--color-border-strong)",
  },
  ".cm-md-image": { color: "var(--color-ink-secondary)" },
  ".cm-md-url": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.86em",
    color: "var(--color-ink-muted)",
    textDecoration: "none",
  },
  ".cm-md-html": { fontFamily: "var(--font-mono)", fontSize: "0.88em", color: "var(--color-ink-muted)" },
  ".cm-md-comment": { color: "var(--color-ink-muted)", fontStyle: "italic" },

  // The markers. Present, legible, and out of the way.
  ".cm-md-mark": { color: "var(--color-ink-faint)", fontWeight: "400" },
});

/** Rich markdown decoration for the source pane: the plugin and its paint. */
export function richMarkdown(): Extension {
  return [plugin, decorationTheme];
}
