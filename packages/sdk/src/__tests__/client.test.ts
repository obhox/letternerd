import { describe, expect, it } from "vitest";
import { createCmsClient, cacheTags } from "../client";
import { CmsError } from "../errors";
import { toSeoDocument } from "../adapt";
import { apiError, fakeFetch, json, listing, post, site, summary } from "./fixtures";
import type { CmsPostSummary } from "../types";

const OPTIONS = { baseUrl: "https://cms.example.com/api/v1", key: "cms_live_secret" };

describe("transport", () => {
  it("authenticates every request with the API key", async () => {
    const fetcher = fakeFetch(() => json(site));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.getSite();

    const headers = fetcher.last().init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer cms_live_secret");
    expect(headers.Accept).toBe("application/json");
  });

  it("declares an ISR window and cache tags on every read", async () => {
    const fetcher = fakeFetch(() => json(site));
    const client = createCmsClient({ ...OPTIONS, revalidate: 120, fetch: fetcher.fetch });

    await client.getSite();

    expect(fetcher.last().init?.next).toEqual({ revalidate: 120, tags: [cacheTags.site] });
  });

  it("tags a single post so the webhook can invalidate just that page", async () => {
    const fetcher = fakeFetch(() => json(post()));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.getPost("cash-flow-basics");

    expect(fetcher.last().init?.next?.tags).toEqual([
      "cms:post:cash-flow-basics",
      "cms:index",
    ]);
  });

  it("merges client-level tags into every read", async () => {
    const fetcher = fakeFetch(() => json(site));
    const client = createCmsClient({ ...OPTIONS, tags: ["cms:all"], fetch: fetcher.fetch });

    await client.getSite();

    expect(fetcher.last().init?.next?.tags).toEqual(["cms:all", "cms:site"]);
  });

  it("refuses to be constructed without a base URL or a key", () => {
    expect(() => createCmsClient({ baseUrl: "", key: "k" })).toThrow(TypeError);
    expect(() => createCmsClient({ baseUrl: "https://x", key: "" })).toThrow(TypeError);
  });

  /**
   * The key rides on every request as a bearer token. A base URL with the
   * wrong scheme would hand it to every hop between the site and the CMS, so
   * the client refuses at construction — before there is a request to leak on.
   */
  it("refuses a plain-http base URL, and says why", () => {
    expect(() => createCmsClient({ baseUrl: "http://cms.example.com/api/v1", key: "k" })).toThrow(
      TypeError,
    );
    expect(() => createCmsClient({ baseUrl: "http://cms.example.com/api/v1", key: "k" })).toThrow(
      /refusing to send the API key over http to cms\.example\.com/,
    );
    expect(() => createCmsClient({ baseUrl: "ftp://cms.example.com", key: "k" })).toThrow(TypeError);
    expect(() => createCmsClient({ baseUrl: "not a url", key: "k" })).toThrow(/not a valid URL/);
  });

  it("allows plain http only to a loopback host", async () => {
    for (const baseUrl of [
      "http://localhost:3000/api/v1",
      "http://127.0.0.1:3000/api/v1",
      "http://[::1]:3000/api/v1",
      "http://studio.localhost:3000/api/v1",
    ]) {
      const fetcher = fakeFetch(() => json(site));
      const client = createCmsClient({ baseUrl, key: "k", fetch: fetcher.fetch });
      await client.getSite();
      expect(fetcher.last().url.href.startsWith(baseUrl)).toBe(true);
    }
    // A name that merely contains "localhost" is not loopback.
    expect(() => createCmsClient({ baseUrl: "http://localhost.evil.com", key: "k" })).toThrow(
      TypeError,
    );
  });
});

describe("pagination", () => {
  it("assembles every page and terminates on a null cursor", async () => {
    const pages: Record<string, ReturnType<typeof listing>> = {
      "": listing([summary({ slug: "a" }), summary({ slug: "b" })], "cursor-2"),
      "cursor-2": listing([summary({ slug: "c" })], "cursor-3"),
      "cursor-3": listing([summary({ slug: "d" })], null),
    };

    const fetcher = fakeFetch((url) => json(pages[url.searchParams.get("cursor") ?? ""]));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const slugs: string[] = [];
    for await (const item of client.listAllPosts()) slugs.push(item.slug);

    expect(slugs).toEqual(["a", "b", "c", "d"]);
    expect(fetcher.calls).toHaveLength(3);
  });

  it("passes limit, cursor, query and type through to the API", async () => {
    const fetcher = fakeFetch(() => json(listing([])));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.listPosts({ limit: 5, cursor: "abc", query: "pricing", type: "page" });

    const url = fetcher.last().url;
    expect(url.pathname).toBe("/api/v1/documents");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("cursor")).toBe("abc");
    expect(url.searchParams.get("query")).toBe("pricing");
    expect(url.searchParams.get("type")).toBe("page");
  });

  it("renames `documents` to `posts` without losing the cursor", async () => {
    const fetcher = fakeFetch(() => json(listing([summary()], "next")));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const page = await client.listPosts();

    expect(page.posts).toHaveLength(1);
    expect(page.nextCursor).toBe("next");
  });

  it("throws rather than looping forever when the API repeats a cursor", async () => {
    const fetcher = fakeFetch(() => json(listing([summary()], "same-cursor")));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(async () => {
      for await (const _ of client.listAllPosts()) {
        // Drained deliberately: the guard must fire from the cursor, not from
        // a consumer that stopped reading.
      }
    }).rejects.toThrow(CmsError);

    // Page one, then the repeat that trips the guard. Not thousands.
    expect(fetcher.calls.length).toBeLessThanOrEqual(3);
  });
});

describe("errors", () => {
  it("throws on 401 instead of returning an empty list", async () => {
    const fetcher = fakeFetch(() => apiError(401, "unauthenticated", "Invalid API key."));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const error = await client.listPosts().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CmsError);
    expect((error as CmsError).status).toBe(401);
    expect((error as CmsError).code).toBe("unauthenticated");
    expect((error as CmsError).retryable).toBe(false);
    expect((error as CmsError).message).toBe("Invalid API key.");
  });

  it("throws a retryable error on 500", async () => {
    const fetcher = fakeFetch(() => apiError(500, "internal"));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const error = (await client.getSite().catch((e: unknown) => e)) as CmsError;

    expect(error.code).toBe("internal");
    expect(error.retryable).toBe(true);
  });

  it("treats rate limiting as retryable", async () => {
    const fetcher = fakeFetch(() => apiError(429, "rate_limited"));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const error = (await client.getSite().catch((e: unknown) => e)) as CmsError;

    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it("reports a transport failure as a retryable network error", async () => {
    const client = createCmsClient({
      ...OPTIONS,
      fetch: async () => {
        throw new Error("ECONNRESET");
      },
    });

    const error = (await client.getSite().catch((e: unknown) => e)) as CmsError;

    expect(error.code).toBe("network");
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });

  it("classifies a status-only failure from a proxy", async () => {
    const fetcher = fakeFetch(() => new Response("<html>502</html>", { status: 502 }));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const error = (await client.getSite().catch((e: unknown) => e)) as CmsError;

    expect(error.status).toBe(502);
    expect(error.retryable).toBe(true);
  });

  it("rejects a 200 that is not JSON", async () => {
    const fetcher = fakeFetch(() => new Response("not json", { status: 200 }));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const error = (await client.getSite().catch((e: unknown) => e)) as CmsError;

    expect(error.code).toBe("malformed_response");
  });

  it("carries the API's extra fields through as details", async () => {
    const fetcher = fakeFetch(() =>
      json({ error: "invalid_input", message: "Bad cursor.", field: "cursor" }, { status: 422 }),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const error = (await client.getSite().catch((e: unknown) => e)) as CmsError;

    expect(error.details).toEqual({ field: "cursor" });
    expect(error.retryable).toBe(false);
  });
});

describe("getPost", () => {
  it("returns null for a genuine 404", async () => {
    const fetcher = fakeFetch(() => apiError(404, "not_found", "Document not found."));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.getPost("missing")).resolves.toBeNull();
  });

  it("throws on 401 rather than pretending the post does not exist", async () => {
    const fetcher = fakeFetch(() => apiError(401, "unauthenticated"));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.getPost("cash-flow-basics")).rejects.toBeInstanceOf(CmsError);
  });

  it("addresses the document by slug and states its type", async () => {
    const fetcher = fakeFetch(() => json(post()));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.getPost("cash-flow-basics");

    expect(fetcher.last().url.pathname).toBe("/api/v1/documents/cash-flow-basics");
    expect(fetcher.last().url.searchParams.get("slug")).toBe("cash-flow-basics");
    expect(fetcher.last().url.searchParams.get("type")).toBe("post");
  });

  it("passes the server's canonical URL straight through", async () => {
    const syndicated = post({ canonicalUrl: "https://medium.com/@jane/cash-flow-basics" });
    const fetcher = fakeFetch(() => json(syndicated));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const fetched = await client.getPost("cash-flow-basics");

    expect(fetched?.canonicalUrl).toBe("https://medium.com/@jane/cash-flow-basics");
    // And it survives adaptation, so every SEO builder emits the same string.
    expect(toSeoDocument(fetched!).canonicalUrlOverride).toBe(
      "https://medium.com/@jane/cash-flow-basics",
    );
  });

  it("bypasses the cache in preview", async () => {
    const fetcher = fakeFetch(() => json(post()));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.getPost("cash-flow-basics", { preview: true });

    expect(fetcher.last().init?.cache).toBe("no-store");
    expect(fetcher.last().init?.next).toBeUndefined();
  });

  it("serves the public markdown rendition", async () => {
    const fetcher = fakeFetch(() => json(post()));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.getPostMarkdown("cash-flow-basics")).resolves.toContain(
      "# Cash flow basics",
    );
  });

  it("returns null markdown for a missing post", async () => {
    const fetcher = fakeFetch(() => apiError(404, "not_found"));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.getPostMarkdown("missing")).resolves.toBeNull();
  });
});

describe("conditional requests", () => {
  it("sends If-None-Match once it has an ETag, and serves the 304 from memory", async () => {
    const fetcher = fakeFetch((_url, init, index) => {
      if (index === 0) return json(site, { headers: { ETag: 'W/"abc123"' } });
      const headers = init?.headers as Record<string, string>;
      expect(headers["If-None-Match"]).toBe('W/"abc123"');
      return new Response(null, { status: 304, headers: { ETag: 'W/"abc123"' } });
    });
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const first = await client.getSite();
    const second = await client.getSite();

    expect(second).toEqual(first);
    expect(fetcher.calls).toHaveLength(2);
  });

  it("retries unconditionally when a 304 arrives with nothing cached", async () => {
    const fetcher = fakeFetch((_url, _init, index) =>
      index === 0 ? new Response(null, { status: 304 }) : json(site),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.getSite()).resolves.toEqual(site);
    expect(fetcher.calls).toHaveLength(2);
    expect((fetcher.last().init?.headers as Record<string, string>)["If-None-Match"]).toBeUndefined();
  });
});

describe("taxonomy, authors and redirects", () => {
  it("asks for each kind of term by name", async () => {
    const fetcher = fakeFetch((url) =>
      json({ kind: url.searchParams.get("kind"), terms: [{ name: "Pricing", slug: "pricing" }] }),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.listTags();
    expect(fetcher.last().url.searchParams.get("kind")).toBe("tag");

    await client.listCategories();
    expect(fetcher.last().url.searchParams.get("kind")).toBe("category");

    await client.listEntities();
    expect(fetcher.last().url.searchParams.get("kind")).toBe("entity");
  });

  it("resolves an author by slug from the cached list", async () => {
    const fetcher = fakeFetch(() =>
      json({ authors: [{ name: "Jane Doe", slug: "jane-doe" }] }),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.getAuthor("jane-doe")).resolves.toMatchObject({ name: "Jane Doe" });
    await expect(client.getAuthor("nobody")).resolves.toBeNull();
  });

  it("flattens hand-written rules and recorded renames into one table", async () => {
    const fetcher = fakeFetch(() =>
      json({
        redirects: [
          { source: "/old", destination: "/new", statusCode: 301, createdAt: "2026-01-01T00:00:00.000Z" },
          { source: "/temp", destination: "/other", statusCode: 302, createdAt: "2026-03-01T00:00:00.000Z" },
        ],
        slugHistory: [
          { oldSlug: "cashflow", newSlug: "cash-flow-basics", statusCode: 301, createdAt: "2026-02-01T00:00:00.000Z" },
        ],
        blogBasePath: "/blog",
      }),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const redirects = await client.getRedirects();

    expect(redirects).toHaveLength(3);
    expect(redirects[0]).toMatchObject({ source: "/old", permanent: true, origin: "manual" });
    expect(redirects[1]?.permanent).toBe(false);
    expect(redirects[2]).toMatchObject({
      source: "/blog/cashflow",
      destination: "/blog/cash-flow-basics",
      origin: "slug_history",
    });
  });

  it("filters redirects by `since`", async () => {
    const fetcher = fakeFetch(() =>
      json({
        redirects: [
          { source: "/old", destination: "/new", createdAt: "2026-01-01T00:00:00.000Z" },
          { source: "/newer", destination: "/x", createdAt: "2026-06-01T00:00:00.000Z" },
        ],
        slugHistory: [],
        blogBasePath: "/blog",
      }),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const redirects = await client.getRedirects("2026-03-01T00:00:00.000Z");

    expect(redirects.map((r) => r.source)).toEqual(["/newer"]);
  });
});

describe("derived reads", () => {
  it("ranks related posts by shared tags, then category, then recency", async () => {
    const target = post({ slug: "target" });
    const candidates: CmsPostSummary[] = [
      summary({ slug: "two-tags", tags: [{ name: "Cash flow", slug: "cash-flow" }, { name: "Pricing", slug: "pricing" }] }),
      summary({ slug: "one-tag", tags: [{ name: "Pricing", slug: "pricing" }] }),
      summary({ slug: "unrelated", tags: [{ name: "Hiring", slug: "hiring" }], category: { name: "Team", slug: "team" } }),
    ];

    const fetcher = fakeFetch((url) =>
      url.pathname.endsWith("/documents") ? json(listing(candidates)) : json(target),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const related = await client.getRelated("target", { limit: 2 });

    expect(related.map((item) => item.slug)).toEqual(["two-tags", "one-tag"]);
  });

  it("gathers the site and every published post for the artifact routes", async () => {
    const fetcher = fakeFetch((url) =>
      url.pathname.endsWith("/site")
        ? json(site)
        : json(listing([summary({ slug: "a" }), summary({ slug: "b" })])),
    );
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    const index = await client.getIndex();

    expect(index.site.baseUrl).toBe("https://spendtab.com");
    expect(index.posts.map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("sends a search as a query, not a client-side filter", async () => {
    const fetcher = fakeFetch(() => json(listing([summary()])));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.search("runway");

    expect(fetcher.last().url.searchParams.get("query")).toBe("runway");
  });
});

describe("logCrawlerHit", () => {
  it("posts the hit without caching it", async () => {
    const fetcher = fakeFetch(() => json({ ok: true }));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await client.logCrawlerHit({ path: "/blog/cash-flow-basics", botName: "ClaudeBot" });

    expect(fetcher.last().init?.method).toBe("POST");
    expect(fetcher.last().init?.cache).toBe("no-store");
    expect(fetcher.last().url.pathname).toBe("/api/v1/insights/crawler-hits");
  });

  it("swallows a network failure rather than breaking the page render", async () => {
    const client = createCmsClient({
      ...OPTIONS,
      fetch: async () => {
        throw new Error("ENOTFOUND");
      },
    });

    await expect(client.logCrawlerHit({ path: "/blog/x" })).resolves.toBeUndefined();
  });

  it("swallows a server error too", async () => {
    const fetcher = fakeFetch(() => apiError(500, "internal"));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(client.logCrawlerHit({ path: "/blog/x" })).resolves.toBeUndefined();
  });
});
