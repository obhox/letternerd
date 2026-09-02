import { describe, expect, it } from "vitest";
import { renderDocument } from "../index.js";
import { articleInput, site } from "./fixtures.js";

const render = (markdown: string) => renderDocument({ markdown, slug: "post", site });

describe(":::tldr", () => {
  it("renders the class the Speakable markup selects on and extracts the text", async () => {
    const result = await render(":::tldr\nMap categories to ledger codes first.\n:::");

    expect(result.html).toContain('<div class="cms-tldr">');
    expect(result.tldr).toBe("Map categories to ledger codes first.");
  });

  it("keeps the first of two, so Speakable reads a stable summary", async () => {
    const result = await render(":::tldr\nFirst.\n:::\n\n:::tldr\nSecond.\n:::");

    expect(result.tldr).toBe("First.");
    expect(result.html.match(/cms-tldr/g)).toHaveLength(2);
  });
});

describe(":::takeaways", () => {
  it("becomes the list itself and extracts every item", async () => {
    const result = await render(":::takeaways\n- One thing\n- Another thing\n:::");

    expect(result.html).toContain('<ul class="cms-takeaways">');
    expect(result.keyTakeaways).toEqual(["One thing", "Another thing"]);
  });

  it("warns rather than throwing when there is no list", async () => {
    const result = await render(":::takeaways\nJust prose.\n:::");

    expect(result.keyTakeaways).toEqual([]);
    expect(result.html).toContain('class="cms-takeaways"');
    expect(result.lints.some((lint) => lint.rule === "unknown-directive")).toBe(true);
  });
});

describe(":::faq", () => {
  it("extracts every question with a frozen anchor and both renderings", async () => {
    const result = await renderDocument(articleInput());

    expect(result.qaBlocks).toHaveLength(2);
    const first = result.qaBlocks[0];
    expect(first?.question).toBe("Can I rename a category later?");
    expect(first?.kind).toBe("faq");
    expect(first?.anchorId).toBe("can-i-rename-a-category-later");
    expect(first?.answerHtml).toContain("<p>");
    expect(first?.answerHtml).toContain("does not change its ledger code");
    expect(first?.answerMd).toContain("does not change its ledger code");
    expect(first?.answerMd).not.toContain("<p>");
  });

  it("renders a section whose questions carry their own ids", async () => {
    const result = await renderDocument(articleInput());

    expect(result.html).toContain('<section class="cms-faq">');
    expect(result.html).toContain('class="cms-faq__question"');
    expect(result.html).toContain('id="can-i-rename-a-category-later"');
  });

  it("numbers questions across two blocks without collision", async () => {
    const result = await render(
      [
        ":::faq",
        "### First question?",
        "",
        "First answer.",
        ":::",
        "",
        ":::faq",
        "### Second question?",
        "",
        "Second answer.",
        ":::",
      ].join("\n"),
    );

    expect(result.qaBlocks.map((block) => block.question)).toEqual([
      "First question?",
      "Second question?",
    ]);
    expect(result.qaBlocks[0]?.answerHtml).toContain("First answer.");
    expect(result.qaBlocks[1]?.answerHtml).toContain("Second answer.");
  });
});

describe(":::howto", () => {
  it("extracts ordered steps and renders them as a numbered list", async () => {
    const result = await renderDocument(articleInput());

    expect(result.howtos).toHaveLength(1);
    expect(result.howtos[0]?.name).toBe("Set up your first category");
    expect(result.howtos[0]?.steps.map((step) => step.text)).toEqual([
      "Open Settings, then Categories.",
      "Enter a name and a general-ledger code.",
      "Invite your team once every code is mapped.",
    ]);

    expect(result.html).toContain('<section class="cms-howto">');
    expect(result.html).toContain('<ol class="cms-howto__steps">');
    expect(result.html).toContain('data-step="1"');
    expect(result.html).toContain('data-step="3"');
  });

  it("accepts container steps for multi-paragraph instructions", async () => {
    const result = await render(
      [
        ":::howto[Migrate]",
        "::::step",
        "Export the old categories.",
        "",
        "Keep the file; you will need it twice.",
        "::::",
        ":::",
      ].join("\n"),
    );

    expect(result.howtos[0]?.steps).toHaveLength(1);
    expect(result.html).toContain("Keep the file");
    expect(result.html).toContain('data-step="1"');
  });
});

describe("::embed", () => {
  it("emits a facade, never an iframe or a third-party script", async () => {
    const result = await renderDocument(articleInput());

    expect(result.html).toContain('class="cms-embed"');
    expect(result.html).toContain('data-provider="youtube"');
    expect(result.html).toContain('data-embed-id="dQw4w9WgXcQ"');
    expect(result.html).toContain("i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(result.html).toContain('class="cms-embed__play"');

    expect(result.html).not.toContain("<iframe");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("youtube.com/embed");
  });

  it("recognises the short and the embed URL forms", async () => {
    const short = await render('::embed{url="https://youtu.be/dQw4w9WgXcQ"}');
    const embed = await render('::embed{url="https://www.youtube.com/embed/dQw4w9WgXcQ"}');

    expect(short.html).toContain('data-embed-id="dQw4w9WgXcQ"');
    expect(embed.html).toContain('data-embed-id="dQw4w9WgXcQ"');
  });

  it("degrades an unknown provider to a link and lints it", async () => {
    const result = await render('::embed{url="https://vimeo.com/12345"}');

    expect(result.html).toContain('href="https://vimeo.com/12345"');
    expect(result.html).not.toContain("data-provider");
    expect(result.lints.some((lint) => lint.rule === "embed-unsupported")).toBe(true);
  });
});

describe("unknown directives", () => {
  it("keeps the prose, drops the wrapper and warns", async () => {
    const result = await render(":::callout\nStill worth reading.\n:::");

    expect(result.html).toContain("Still worth reading.");
    expect(result.html).not.toContain("callout");
    const finding = result.lints.find((lint) => lint.rule === "unknown-directive");
    expect(finding?.severity).toBe("warning");
    expect(finding?.line).toBe(1);
  });
});
