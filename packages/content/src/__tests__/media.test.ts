import { describe, expect, it } from "vitest";
import { EMBED_PROVIDERS, mediaId, renderDocument, resolveEmbed } from "../index.js";
import { resolveMedia, site } from "./fixtures.js";

const render = (markdown: string) =>
  renderDocument({ markdown, slug: "post", site, resolveMedia });

describe("media references", () => {
  it("recognises the protocol and nothing else", () => {
    expect(mediaId("media://asset-1")).toBe("asset-1");
    expect(mediaId("https://cdn.example.com/a.png")).toBeUndefined();
    expect(mediaId("/local.png")).toBeUndefined();
  });

  it("renders a standalone image as a figure with intrinsic dimensions", async () => {
    const { html } = await render("![A revenue chart](media://asset-chart)");

    expect(html).toContain('<figure class="cms-figure">');
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('<figcaption>MRR, January to December.</figcaption>');
    // Never nested inside the paragraph that held the image.
    expect(html).not.toContain("<p><figure");
  });

  it("builds a srcset ordered by width, whatever order the variants arrive in", async () => {
    const { html } = await render("![A revenue chart](media://asset-chart)");

    expect(html).toContain(
      'srcset="https://cdn.spendtab.com/asset-chart/320.webp 320w, https://cdn.spendtab.com/asset-chart/640.webp 640w, https://cdn.spendtab.com/asset-chart/1600.webp 1600w"',
    );
    expect(html).toContain('sizes="(max-width: 720px) 100vw, 720px"');
  });

  it("prefers the document's alt text over the asset's", async () => {
    const { html } = await render("![A different description](media://asset-chart)");

    expect(html).toContain('alt="A different description"');
  });

  it("keeps an inline image inline, still with its dimensions", async () => {
    const { html } = await render("Our logo ![Spendtab](media://asset-logo) sits inline.");

    expect(html).not.toContain("<figure");
    expect(html).toContain('width="200"');
    expect(html).toContain('height="60"');
    expect(html).toContain('src="https://cdn.spendtab.com/asset-logo/200.png"');
  });

  it("omits srcset when the asset has no variants", async () => {
    const { html } = await render("![Spendtab](media://asset-logo)");

    expect(html).not.toContain("srcset");
    expect(html).not.toContain("sizes=");
  });

  it("passes the blurhash through for a placeholder", async () => {
    const { html } = await render("![A revenue chart](media://asset-chart)");

    expect(html).toContain('data-blurhash="LEHV6nWB2yk8pyo0adR*"');
  });
});

describe("the embed provider registry", () => {
  it("has one entry today and matches on hostname", () => {
    expect(EMBED_PROVIDERS.map((provider) => provider.provider)).toEqual(["youtube"]);
  });

  it("resolves every YouTube URL shape to the same id", () => {
    const ids = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ].map((url) => resolveEmbed(url)?.id);

    expect(ids).toEqual(Array.from({ length: 5 }, () => "dQw4w9WgXcQ"));
  });

  it("refuses anything it does not understand rather than guessing", () => {
    expect(resolveEmbed("https://vimeo.com/12345")).toBeUndefined();
    expect(resolveEmbed("https://www.youtube.com/watch?v=too-short")).toBeUndefined();
    expect(resolveEmbed("not a url")).toBeUndefined();
    expect(resolveEmbed("javascript:alert(1)")).toBeUndefined();
  });

  it("describes a poster with real dimensions, so the facade reserves space", () => {
    const info = resolveEmbed("https://youtu.be/dQw4w9WgXcQ");

    expect(info?.posterWidth).toBeGreaterThan(0);
    expect(info?.posterHeight).toBeGreaterThan(0);
    expect(info?.watchUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});
