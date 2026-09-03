import { describe, expect, it } from "vitest";
import { createCmsClient } from "../client";
import { createLegacyApi, toLegacyPost, type LegacyPost } from "../legacy";
import { fakeFetch, json, listing, post, summary } from "./fixtures";

/**
 * The acceptance test for the whole design: an existing site's `Post` interface
 * and its three functions, satisfied field-for-field so that `app/blog/**`
 * needs no changes at all.
 */

const OPTIONS = { baseUrl: "https://cms.example.com/api/v1", key: "cms_live_secret" };

/** Every key the consuming site's interface declares. */
const REQUIRED_KEYS = [
  "slug",
  "title",
  "description",
  "date",
  "author",
  "category",
  "tags",
  "readingTime",
  "content",
] as const;

describe("toLegacyPost", () => {
  it("produces every field the interface declares, with the declared types", () => {
    const legacy = toLegacyPost(post());

    for (const key of REQUIRED_KEYS) expect(legacy).toHaveProperty(key);

    expect(typeof legacy.slug).toBe("string");
    expect(typeof legacy.title).toBe("string");
    expect(typeof legacy.description).toBe("string");
    expect(typeof legacy.date).toBe("string");
    expect(typeof legacy.author).toBe("string");
    expect(typeof legacy.category).toBe("string");
    expect(Array.isArray(legacy.tags)).toBe(true);
    expect(typeof legacy.readingTime).toBe("number");
    expect(typeof legacy.content).toBe("string");
    expect(typeof legacy.authorTitle).toBe("string");
    expect(typeof legacy.dateModified).toBe("string");
  });

  it("maps the CMS's values onto the legacy names", () => {
    const legacy = toLegacyPost(post());

    expect(legacy).toMatchObject({
      slug: "cash-flow-basics",
      title: "Cash flow basics",
      description: "What cash flow is and why it bites.",
      author: "Jane Doe",
      authorTitle: "Finance Writer",
      category: "Finance",
      tags: ["Cash flow", "Pricing"],
      readingTime: 6,
    });
    expect(legacy.content).toContain("<p>Body.</p>");
  });

  it("truncates timestamps to the YYYY-MM-DD the interface documents", () => {
    const legacy = toLegacyPost(post());

    expect(legacy.date).toBe("2026-01-05");
    expect(legacy.dateModified).toBe("2026-02-01");
    // Still lexicographically sortable, which is what the existing pages rely on.
    expect(legacy.date < legacy.dateModified!).toBe(true);
  });

  it("omits dateModified when nothing has been modified", () => {
    const legacy = toLegacyPost(post({ dateModified: "2026-01-05T09:00:00.000Z" }));

    expect(legacy.dateModified).toBeUndefined();
  });

  it("falls back to the excerpt when there is no meta description", () => {
    const legacy = toLegacyPost(post({ description: null }));

    expect(legacy.description).toBe("A short excerpt.");
  });

  it("derives a reading time from the word count when the CMS has none", () => {
    const legacy = toLegacyPost(
      post({ readingTimeMinutes: undefined, wordCount: 450 }),
    );

    expect(legacy.readingTime).toBe(3);
  });

  it("applies the configured defaults for an unattributed, unfiled post", () => {
    const legacy = toLegacyPost(post({ author: null, authors: [], category: null }), {
      defaultAuthor: "SpendTab Team",
    });

    expect(legacy.author).toBe("SpendTab Team");
    expect(legacy.category).toBe("General");
  });

  it("uses the listing's joined byline when there is no author object", () => {
    const legacy = toLegacyPost(
      summary({ author: null, authorName: "Joined Name" }),
    );

    expect(legacy.author).toBe("Joined Name");
    // A summary carries no body; the field is present and empty rather than absent.
    expect(legacy.content).toBe("");
  });
});

describe("createLegacyApi", () => {
  function stub(slugs: string[]) {
    const fetcher = fakeFetch((url) => {
      if (url.pathname.endsWith("/documents")) {
        return json(
          listing(
            slugs.map((slug, index) =>
              summary({
                slug,
                title: `Post ${slug}`,
                publishedAt: `2026-0${index + 1}-01T00:00:00.000Z`,
              }),
            ),
          ),
        );
      }
      const slug = url.pathname.split("/").pop() ?? "";
      return json(post({ slug, title: `Post ${slug}`, bodyHtml: `<p>${slug}</p>` }));
    });
    return { client: createCmsClient({ ...OPTIONS, fetch: fetcher.fetch }), fetcher };
  }

  it("returns every post, newest first, with its rendered body", async () => {
    const { client } = stub(["oldest", "middle", "newest"]);
    const api = createLegacyApi(client);

    const posts: LegacyPost[] = await api.getAllPosts();

    expect(posts.map((p) => p.slug)).toEqual(["newest", "middle", "oldest"]);
    expect(posts[0]?.content).toBe("<p>newest</p>");
  });

  it("skips hydration when told to, and says so by leaving content empty", async () => {
    const { client, fetcher } = stub(["a", "b"]);
    const api = createLegacyApi(client, { hydrate: false });

    const posts = await api.getAllPosts();

    expect(posts.every((p) => p.content === "")).toBe(true);
    expect(fetcher.calls.filter((call) => /\/documents\/./.test(call.url.pathname))).toHaveLength(0);
  });

  it("returns one post by slug", async () => {
    const { client } = stub(["a"]);
    const api = createLegacyApi(client);

    await expect(api.getPostBySlug("a")).resolves.toMatchObject({ slug: "a" });
  });

  it("returns null for a slug that does not exist, as the filesystem version did", async () => {
    const fetcher = fakeFetch(() => json({ error: "not_found", message: "no" }, { status: 404 }));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(createLegacyApi(client).getPostBySlug("missing")).resolves.toBeNull();
  });

  it("lists slugs for generateStaticParams", async () => {
    const { client } = stub(["a", "b", "c"]);

    await expect(createLegacyApi(client).getAllSlugs()).resolves.toEqual(["c", "b", "a"]);
  });

  it("propagates an authentication failure instead of reporting an empty blog", async () => {
    const fetcher = fakeFetch(() => json({ error: "unauthenticated", message: "no" }, { status: 401 }));
    const client = createCmsClient({ ...OPTIONS, fetch: fetcher.fetch });

    await expect(createLegacyApi(client).getAllPosts()).rejects.toThrow();
  });
});
