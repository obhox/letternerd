import { describe, expect, it } from "vitest";
import { hasStructuralMarkup, htmlToMarkdown } from "../paste-html";

/**
 * A hand-written HTML-to-markdown converter, so every construct it claims to
 * handle is a separate branch that can rot on its own. The cases below are the
 * ones an author actually pastes — a passage out of a Google Doc, a Notion
 * page or a published article — and each asserts the exact markdown, because
 * "contains a heading somewhere" would not notice the heading landing at the
 * wrong level or the paragraph after it being swallowed.
 */
describe("htmlToMarkdown", () => {
  it("converts headings at the level the source used", () => {
    // A pasted <h1> that arrives as <h2> silently rewrites the document
    // outline, which is the thing the pasted structure was worth keeping for.
    expect(htmlToMarkdown("<h1>One</h1><h6>Six</h6>")).toBe("# One\n\n###### Six");
    expect(htmlToMarkdown("<h2>Getting started</h2>")).toBe("## Getting started");
  });

  it("converts bold and italic, including the tag spellings word processors emit", () => {
    // Google Docs emits <b>/<i>; most CMSs emit <strong>/<em>. Both are the
    // same intent and both have to survive.
    expect(htmlToMarkdown("<p>Some <strong>bold</strong> and <em>italic</em>.</p>")).toBe(
      "Some **bold** and *italic*.",
    );
    expect(htmlToMarkdown("<p>Some <b>bold</b> and <i>italic</i>.</p>")).toBe(
      "Some **bold** and *italic*.",
    );
  });

  it("moves whitespace outside the emphasis markers", () => {
    // `a ** b ** c` is not emphasis in any markdown flavour — the markers have
    // to hug the words, or the asterisks render literally.
    expect(htmlToMarkdown("<p>a<strong> b </strong>c</p>")).toBe("a **b** c");
  });

  it("converts a link to its label and href", () => {
    expect(htmlToMarkdown('<p>See <a href="https://example.com/docs">the docs</a> for more.</p>')).toBe(
      "See [the docs](https://example.com/docs) for more.",
    );
  });

  it("drops the target of a link that carries a script scheme, keeping the words", () => {
    // Pasting from a hostile page must not carry `javascript:` into a document
    // that a site will later render. The visible text is not the danger, so it
    // stays and only the href goes.
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">Click</a></p>')).toBe("Click");
    expect(htmlToMarkdown('<p><a href="data:text/html,<b>x</b>">Click</a></p>')).toBe("Click");
  });

  it("indents a nested list under its parent item", () => {
    // The nested <ul> is a child of the <li>, not a sibling. Emitting it as a
    // sibling flattens two levels into one and loses the structure entirely.
    expect(
      htmlToMarkdown("<ul><li>One<ul><li>One a</li><li>One b</li></ul></li><li>Two</li></ul>"),
    ).toBe("- One\n  - One a\n  - One b\n- Two");
  });

  it("numbers an ordered list from its start attribute", () => {
    expect(htmlToMarkdown('<ol start="3"><li>Three</li><li>Four</li></ol>')).toBe(
      "3. Three\n4. Four",
    );
  });

  it("fences a code block and keeps its language and line breaks", () => {
    // Code is the one place where collapsing whitespace would destroy the
    // content rather than tidy it.
    expect(
      htmlToMarkdown('<pre><code class="language-ts">const a = 1;\nconst b = 2;</code></pre>'),
    ).toBe("```ts\nconst a = 1;\nconst b = 2;\n```");
  });

  it("lengthens the fence past any backtick run inside the code", () => {
    // A pasted snippet that itself contains a fence would otherwise end the
    // block early and spill the rest of it into the document as prose.
    const markdown = htmlToMarkdown("<pre><code>a ``` b</code></pre>");
    expect(markdown).toBe("````\na ``` b\n````");
  });

  it("wraps inline code in a fence longer than the backticks it contains", () => {
    expect(htmlToMarkdown("<p>Use <code>npm run dev</code> now.</p>")).toBe("Use `npm run dev` now.");
    expect(htmlToMarkdown("<p>Type <code>a ` b</code>.</p>")).toBe("Type ``a ` b``.");
  });

  it("converts a table with its header row and divider", () => {
    expect(
      htmlToMarkdown(
        "<table><thead><tr><th>Name</th><th>Role</th></tr></thead>" +
          "<tbody><tr><td>Ada</td><td>Owner</td></tr></tbody></table>",
      ),
    ).toBe("| Name | Role |\n| --- | --- |\n| Ada | Owner |");
  });

  it("pads a ragged table to the widest row", () => {
    // Markdown tables are positional. A short row shifts every cell after it
    // into the wrong column.
    expect(
      htmlToMarkdown("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>"),
    ).toBe("| a | b |\n| --- | --- |\n| c |  |");
  });

  it("escapes a pipe inside a cell so it does not end the cell", () => {
    expect(htmlToMarkdown("<table><tr><th>A|B</th></tr><tr><td>c</td></tr></table>")).toBe(
      "| A\\|B |\n| --- |\n| c |",
    );
  });

  it("prefixes every line of a blockquote, blank lines included", () => {
    expect(htmlToMarkdown("<blockquote><p>Quoted line.</p><p>Second.</p></blockquote>")).toBe(
      "> Quoted line.\n>\n> Second.",
    );
  });

  it("keeps a hard line break inside a paragraph", () => {
    // A <br> the author typed is a line break they meant; markdown spells it
    // with a trailing backslash.
    expect(htmlToMarkdown("<p>Line one<br>Line two</p>")).toBe("Line one\\\nLine two");
  });

  it("takes no text from script or style elements", () => {
    // Copying a whole article region picks up the page's inline scripts and
    // stylesheets. Neither is prose, and both would be pasted verbatim.
    expect(htmlToMarkdown("<p>Hi</p><script>alert(1)</script><style>p{color:red}</style>")).toBe(
      "Hi",
    );
  });

  it("converts an image to markdown with its alt text", () => {
    expect(htmlToMarkdown('<p><img src="/media/a.png" alt="A cat"></p>')).toBe(
      "![A cat](/media/a.png)",
    );
  });

  it("unwraps the presentational containers a word processor wraps everything in", () => {
    // The Google Docs clipboard is a thicket of <div> and <span style>. None
    // of it means anything in markdown, and the content inside it does.
    expect(
      htmlToMarkdown('<div><p><span style="font-weight:700">Hi</span> there</p><h3>Sub</h3></div>'),
    ).toBe("Hi there\n\n### Sub");
  });

  it("converts a horizontal rule", () => {
    expect(htmlToMarkdown("<p>a</p><hr><p>b</p>")).toBe("a\n\n---\n\nb");
  });

  it("returns null when there is nothing to keep, so the caller pastes plain text", () => {
    // Returning "" here would look like a successful conversion and replace
    // the author's paste with nothing.
    expect(htmlToMarkdown("<span>   </span>")).toBeNull();
    expect(htmlToMarkdown("")).toBeNull();
  });
});

/**
 * The gate in front of the converter. Copying from a terminal or another code
 * editor still puts a `text/html` flavour on the clipboard — usually a `<span>`
 * or a `<pre>` around the same characters — and converting that is at best a
 * no-op and at worst mangles the indentation the author was copying.
 */
describe("hasStructuralMarkup", () => {
  it.each([
    ["a heading", "<h2>Title</h2>"],
    ["a list", "<ul><li>a</li></ul>"],
    ["a link", '<a href="/x">x</a>'],
    ["a table", "<table><tr><td>a</td></tr></table>"],
    ["a paragraph", "<p>text</p>"],
    ["bold", "<strong>text</strong>"],
    // Upper-case tags: the clipboard's HTML is not normalised, and a
    // case-sensitive test would silently stop converting for some sources.
    ["upper-case tags", "<P>text</P>"],
  ])("recognises %s as worth converting", (_label, html) => {
    expect(hasStructuralMarkup(html)).toBe(true);
  });

  it.each([
    ["plain text", "just some words"],
    ["a bare span", '<span style="color:red">text</span>'],
    ["an unrelated element", "<section-x>text</section-x>"],
  ])("does not treat %s as structural", (_label, html) => {
    expect(hasStructuralMarkup(html)).toBe(false);
  });
});
