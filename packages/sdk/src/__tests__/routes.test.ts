import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `next/cache` only works inside a running Next server, so it is mocked — which
 * also makes "which tags did the webhook purge" directly assertable, and that
 * is the property that decides whether a publish updates one page or none.
 */
const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }));

import { createCmsClient } from "../client";
import {
  cmsRedirects,
  createBlogSitemapRoute,
  createFeedRoute,
  createLlmsFullTxtRoute,
  createLlmsTxtRoute,
  createPostMarkdownRoute,
  createRevalidateWebhookRoute,
  createRobotsRoute,
  createSitemapIndexRoute,
  listingMetadata,
  postMetadata,
} from "../next";
import { signWebhookPayload } from "../webhook";
import { fakeFetch, json, listing, post, site, summary } from "./fixtures";

const OPTIONS = { baseUrl: "https://cms.example.com/api/v1", key: "cms_live_secret" };

/** A client backed by a two-post site: the listing, the site, and each document. */
function stubClient(slugs = ["cash-flow-basics", "runway"]) {
  const fetcher = fakeFetch((url) => {
    if (url.pathname.endsWith("/site")) return json(site);
    if (url.pathname.endsWith("/documents")) {
      return json(listing(slugs.map((slug) => summary({ slug, title: `Post ${slug}` }))));
    }
    const slug = url.pathname.split("/").pop() ?? "";
    return json(post({ slug, title: `Post ${slug}` }));
  });
  return { client: createCmsClient({ ...OPTIONS, fetch: fetcher.fetch }), fetcher };
}

describe("sitemap routes", () => {
  it("serves XML built from the site's own origin", async () => {
    const { client } = stubClient();
    const response = await createBlogSitemapRoute(client)(new Request("https://spendtab.com/sitemap.xml"));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(body).toContain("<urlset");
    expect(body).toContain("<loc>https://spendtab.com/blog/cash-flow-basics</loc>");
    expect(body).not.toContain("cms.example.com");
  });

  it("includes extra entries the consuming site owns", async () => {
    const { client } = stubClient();
    const route = createBlogSitemapRoute(client, {
      extraEntries: [{ path: "/", changeFrequency: "daily", priority: 1 }],
    });

    const body = await (await route(new Request("https://spendtab.com/sitemap.xml"))).text();

    expect(body).toContain("<loc>https://spendtab.com</loc>");
  });

  it("serves a sitemap index naming one chunk per 45 000 URLs", async () => {
    const { client } = stubClient();
    const route = createSitemapIndexRoute(client, { chunkSize: 1 });

    const response = await route(new Request("https://spendtab.com/sitemap.xml"));
    const body = await response.text();

    expect(body).toContain("<sitemapindex");
    expect(body).toContain("<loc>https://spendtab.com/sitemaps/blog-1.xml</loc>");
    expect(body).toContain("<loc>https://spendtab.com/sitemaps/blog-2.xml</loc>");
    expect(body).toContain("<lastmod>");
  });
});

describe("robots route", () => {
  it("names every AI crawler and points at the sitemap absolutely", async () => {
    const { client } = stubClient();
    const response = await createRobotsRoute(client)(new Request("https://spendtab.com/robots.txt"));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain("Sitemap: https://spendtab.com/sitemap.xml");
  });

  it("blocks them on request", async () => {
    const { client } = stubClient();
    const route = createRobotsRoute(client, { aiCrawlers: "block" });

    const body = await (await route(new Request("https://spendtab.com/robots.txt"))).text();

    expect(body).toContain("User-agent: GPTBot\nDisallow: /");
  });
});

describe("feed routes", () => {
  it("serves RSS with the right content type and the full article body", async () => {
    const { client } = stubClient();
    const response = await createFeedRoute(client, "rss")(new Request("https://spendtab.com/rss.xml"));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8");
    expect(body).toContain("<rss version=\"2.0\"");
    expect(body).toContain("<content:encoded>");
    // Hydrated: the body came from the document endpoint, not the listing.
    expect(body).toContain("cms-tldr");
  });

  it("serves Atom", async () => {
    const { client } = stubClient();
    const response = await createFeedRoute(client, "atom")(new Request("https://spendtab.com/atom.xml"));

    expect(response.headers.get("Content-Type")).toBe("application/atom+xml; charset=utf-8");
    expect(await response.text()).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\"");
  });

  it("serves JSON Feed", async () => {
    const { client } = stubClient();
    const response = await createFeedRoute(client, "json")(new Request("https://spendtab.com/feed.json"));
    const body = (await response.json()) as { version: string; items: unknown[] };

    expect(response.headers.get("Content-Type")).toBe("application/feed+json; charset=utf-8");
    expect(body.version).toBe("https://jsonfeed.org/version/1.1");
    expect(body.items).toHaveLength(2);
  });

  it("skips hydration when the caller asks for excerpts only", async () => {
    const { client, fetcher } = stubClient();
    const route = createFeedRoute(client, "rss", { fullContent: false });

    await route(new Request("https://spendtab.com/rss.xml"));

    // The site and the listing, and no per-document fetches.
    expect(fetcher.calls.filter((call) => /\/documents\/./.test(call.url.pathname))).toHaveLength(0);
  });
});

describe("llms routes", () => {
  it("serves llms.txt grouped by category", async () => {
    const { client } = stubClient();
    const response = await createLlmsTxtRoute(client)(new Request("https://spendtab.com/llms.txt"));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(body).toContain("# SpendTab");
    expect(body).toContain("### Finance");
    expect(body).toContain("https://spendtab.com/blog/cash-flow-basics");
  });

  it("streams llms-full.txt in batches, with the site header exactly once", async () => {
    const { client } = stubClient(["a", "b", "c", "d", "e"]);
    const route = createLlmsFullTxtRoute(client, { batchSize: 2 });

    const response = await route(new Request("https://spendtab.com/llms-full.txt"));
    expect(response.body).toBeInstanceOf(ReadableStream);

    const body = await response.text();

    expect(body.split("# SpendTab").length - 1).toBe(1);
    // One document block each, and every document present.
    expect(body.split("\n# Post ").length - 1).toBe(5);
    for (const slug of ["a", "b", "c", "d", "e"]) expect(body).toContain(`/blog/${slug}`);
  });

  it("streams an empty site as just the header", async () => {
    const { client } = stubClient([]);
    const response = await createLlmsFullTxtRoute(client)(
      new Request("https://spendtab.com/llms-full.txt"),
    );

    expect((await response.text()).trim()).toContain("# SpendTab");
  });
});

describe("markdown route", () => {
  it("serves the public markdown rendition as text/markdown", async () => {
    const { client } = stubClient();
    const route = createPostMarkdownRoute(client);

    const response = await route(new Request("https://spendtab.com/blog/runway.md"), {
      params: Promise.resolve({ slug: "runway.md" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toContain("# Cash flow basics");
  });

  it("404s a slug the CMS does not have", async () => {
    const fetcher = fakeFetch(() => json({ error: "not_found", message: "no" }, { status: 404 }));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const response = await createPostMarkdownRoute(client)(
      new Request("https://spendtab.com/blog/missing.md"),
      { params: { slug: "missing" } },
    );

    expect(response.status).toBe(404);
  });
});

describe("revalidation webhook route", () => {
  const secret = "whsec_test";
  const NOW_MS = 1_800_000_000_000;
  const now = () => NOW_MS;

  function signedRequest(body: string, timestampSeconds = Math.floor(NOW_MS / 1000)): Request {
    return new Request("https://spendtab.com/api/revalidate", {
      method: "POST",
      body,
      headers: { "x-cms-signature": signWebhookPayload(secret, body, timestampSeconds) },
    });
  }

  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
  });

  it("revalidates the post and the index for a signed publish", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });
    const body = JSON.stringify({ event: "document.published", slug: "cash-flow-basics" });

    const response = await route(signedRequest(body));

    expect(response.status).toBe(200);
    const purged = revalidateTag.mock.calls.map((call) => call[0]);
    expect(purged).toContain("cms:post:cash-flow-basics");
    expect(purged).toContain("cms:index");
  });

  it("purges the site tag when settings change", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });
    const body = JSON.stringify({ event: "site.updated" });

    await route(signedRequest(body));

    expect(revalidateTag.mock.calls.map((call) => call[0])).toContain("cms:site");
  });

  it("refuses an unsigned request without revalidating anything", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });

    const response = await route(
      new Request("https://spendtab.com/api/revalidate", {
        method: "POST",
        body: JSON.stringify({ event: "document.published", slug: "x" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ revalidated: false, reason: "missing" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a request signed with the wrong secret", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });
    const body = JSON.stringify({ event: "document.published", slug: "x" });

    const response = await route(
      new Request("https://spendtab.com/api/revalidate", {
        method: "POST",
        body,
        headers: {
          "x-cms-signature": signWebhookPayload("whsec_other", body, Math.floor(NOW_MS / 1000)),
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a replayed request", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });
    const body = JSON.stringify({ event: "document.published", slug: "x" });

    const response = await route(signedRequest(body, Math.floor(NOW_MS / 1000) - 4000));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ reason: "stale" });
  });

  it("refuses a body altered after signing", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });
    const body = JSON.stringify({ event: "document.published", slug: "x" });
    const signed = signedRequest(body);

    const tampered = new Request(signed.url, {
      method: "POST",
      body: JSON.stringify({ event: "document.published", slug: "y" }),
      headers: signed.headers,
    });

    const response = await route(tampered);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ reason: "mismatch" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates explicit paths when asked", async () => {
    const route = createRevalidateWebhookRoute({ secret, now });
    const body = JSON.stringify({ event: "document.published", paths: ["/blog"] });

    await route(signedRequest(body));

    expect(revalidatePath).toHaveBeenCalledWith("/blog");
  });
});

describe("next.config redirects", () => {
  it("maps both redirect sources onto Next's shape", async () => {
    const fetcher = fakeFetch(() =>
      json({
        redirects: [{ source: "/old", destination: "/new", statusCode: 301 }],
        slugHistory: [{ oldSlug: "a", newSlug: "b", statusCode: 301 }],
        blogBasePath: "/blog",
      }),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const redirects = await cmsRedirects(client)();

    expect(redirects).toEqual([
      { source: "/old", destination: "/new", permanent: true },
      { source: "/blog/a", destination: "/blog/b", permanent: true },
    ]);
  });
});

describe("metadata", () => {
  it("uses the canonical the API built, on every surface", () => {
    const metadata = postMetadata(post({ canonicalUrl: "https://spendtab.com/blog/x" }), site);

    expect(metadata.alternates?.canonical).toBe("https://spendtab.com/blog/x");
    expect(metadata.openGraph?.url).toBe("https://spendtab.com/blog/x");
  });

  it("advertises the markdown alternate", () => {
    const metadata = postMetadata(post(), site);

    expect(metadata.alternates?.types).toMatchObject({
      "text/markdown": "https://spendtab.com/blog/cash-flow-basics.md",
    });
  });

  it("asks for a large image preview and an unlimited snippet", () => {
    const metadata = postMetadata(post(), site);
    const googleBot = (metadata.robots as { googleBot: Record<string, unknown> }).googleBot;

    expect(googleBot["max-image-preview"]).toBe("large");
    expect(googleBot["max-snippet"]).toBe(-1);
  });

  it("marks a listing page as a website rather than an article", () => {
    const metadata = listingMetadata(site, { title: "Blog", path: "/blog" });

    expect((metadata.openGraph as { type?: string } | undefined)?.type).toBe("website");
    expect(metadata.alternates?.canonical).toBe("https://spendtab.com/blog");
  });

  it("keeps a noindex document out of the index but still followed", () => {
    const metadata = postMetadata(post({ noindex: true }), site);

    expect((metadata.robots as { index: boolean }).index).toBe(false);
    expect((metadata.robots as { follow: boolean }).follow).toBe(true);
  });
});
