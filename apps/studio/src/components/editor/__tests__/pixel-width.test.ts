import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The module memoises its canvas in a module-level variable, so the fake has
 * to be in place before the first measurement. Each test loads a fresh copy.
 *
 * The stub charges a flat 10px per *code point*, which is not how proportional
 * type works but is exactly what makes the truncation arithmetic assertable:
 * with a real font the expected output would be whatever the implementation
 * produced, which is not a test.
 */
async function loadWithCanvas(measure: ((text: string) => number) | null) {
  vi.resetModules();

  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") return realCreateElement(tagName);
    return {
      getContext: () =>
        measure === null
          ? null
          : { font: "", measureText: (text: string) => ({ width: measure(text) }) },
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);

  return import("../pixel-width");
}

const perCodePoint = (text: string) => Array.from(text).length * 10;

/** A high surrogate with no low after it, or a low one with no high before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("measureWidth", () => {
  it("returns the rendered width rather than a character count", async () => {
    // The entire reason this module exists: "58 of 60 characters" is measuring
    // the wrong thing, because a title of thirty W's and a title of thirty i's
    // are not the same width.
    const { measureWidth, SERP_TITLE_FONT } = await loadWithCanvas(
      (text) => (text.match(/W/g)?.length ?? 0) * 30 + text.length * 5,
    );
    expect(measureWidth("WWW", SERP_TITLE_FONT)).toBe(105);
    expect(measureWidth("iii", SERP_TITLE_FONT)).toBe(15);
  });

  it("returns null instead of throwing where there is no canvas to measure with", async () => {
    // The panel renders on the server first, and a browser configured to block
    // site data hands back a null context. Either way this must degrade to "no
    // number to show", not take the editor down.
    const { measureWidth, SERP_TITLE_FONT } = await loadWithCanvas(null);
    expect(measureWidth("Anything", SERP_TITLE_FONT)).toBeNull();
  });
});

describe("fitToWidth", () => {
  it("leaves a string that fits alone", async () => {
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(perCodePoint);
    expect(fitToWidth("short", SERP_TITLE_FONT, 100)).toEqual({
      shown: "short",
      width: 50,
      truncated: false,
    });
  });

  it("reports the full width even once the string is cut", async () => {
    // The panel shows measured-versus-limit so an author can judge how far
    // over they are. Reporting the truncated width would always read as "just
    // at the limit", which is useless.
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(perCodePoint);
    const fitted = fitToWidth("antidisestablishmentarianism", SERP_TITLE_FONT, 130);
    expect(fitted?.width).toBe(280);
    expect(fitted?.truncated).toBe(true);
  });

  it("leaves room for the ellipsis inside the limit", async () => {
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(perCodePoint);
    const fitted = fitToWidth("antidisestablishmentarianism", SERP_TITLE_FONT, 130);
    // 130px budget, 10px of it spent on the ellipsis: twelve characters, not
    // thirteen. An off-by-one here renders a string wider than the limit it is
    // supposed to be demonstrating.
    expect(fitted?.shown).toBe("antidisestab…");
    expect(perCodePoint(fitted!.shown)).toBeLessThanOrEqual(130);
  });

  it("cuts back to a nearby word boundary", async () => {
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(perCodePoint);
    // Twelve characters fit — "wonderful hi" — and the space is late enough in
    // that run to be worth backing off to.
    expect(fitToWidth("wonderful hi there", SERP_TITLE_FONT, 130)?.shown).toBe("wonderful…");
  });

  it("does not back off to a distant word boundary", async () => {
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(perCodePoint);
    // The space here sits in the first sixth of what fits. Honouring it would
    // show "a…" for a title that renders far more than that, which
    // misrepresents the result rather than approximating it.
    expect(fitToWidth("a supercalifragilistic word", SERP_TITLE_FONT, 130)?.shown).toBe(
      "a supercalif…",
    );
  });

  it("never cuts through an astral character", async () => {
    // The search runs over code points rather than UTF-16 units. Cutting by
    // index would leave a lone surrogate — a replacement glyph in the preview,
    // and an invalid string on its way anywhere else.
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(perCodePoint);
    const fitted = fitToWidth("👍👍👍👍", SERP_TITLE_FONT, 35);
    expect(fitted?.shown).toBe("👍👍…");
    // Belt and braces: no lone surrogate anywhere in the result — a high one
    // with no low after it, or a low one with no high before it.
    expect(LONE_SURROGATE.test(fitted!.shown)).toBe(false);
  });

  it("returns null where there is no canvas, so the panel shows nothing rather than a guess", async () => {
    const { fitToWidth, SERP_TITLE_FONT } = await loadWithCanvas(null);
    expect(fitToWidth("Anything at all", SERP_TITLE_FONT, 600)).toBeNull();
  });
});

describe("the limits the panel measures against", () => {
  it("keeps the title limit below the description limit", async () => {
    // Not arithmetic — a guard on the constants. They are approximations of
    // someone else's rendering, and swapping the two would make every title
    // look comfortable and every description look over.
    const {
      SERP_TITLE_LIMIT_PX,
      SERP_DESCRIPTION_LIMIT_PX,
      SERP_TITLE_FONT,
      SERP_DESCRIPTION_FONT,
    } = await loadWithCanvas(perCodePoint);

    expect(SERP_TITLE_LIMIT_PX).toBeLessThan(SERP_DESCRIPTION_LIMIT_PX);
    expect(SERP_TITLE_FONT).not.toBe(SERP_DESCRIPTION_FONT);
  });
});
