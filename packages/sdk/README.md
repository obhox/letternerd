# `@letternerd/sdk`

The typed client a Next.js site uses to server-render CMS content **on its own
domain**. Content is authored in the studio; the pages, the sitemap, the feeds
and the canonical URLs all belong to the consuming site.

Three entry points:

| Import | Needs | What it is |
| --- | --- | --- |
| `@letternerd/sdk` | `fetch` | The client, the error type, the JSON-LD and artifact builders. |
| `@letternerd/sdk/next` | Next + React | Route handlers, `Metadata` helpers, three components. |
| `@letternerd/sdk/legacy` | `fetch` | A drop-in for a site that already has a `lib/posts.ts`. |

The core entry imports no framework, so the same client runs in a server
component, a worker, a cron script and a test.

---

## 1. The client

```ts
// lib/cms.ts
import { createCmsClient } from "@letternerd/sdk";

export const cms = createCmsClient({
  baseUrl: process.env.CMS_API_URL!,   // https://studio.example.com/api/v1
  key: process.env.CMS_API_KEY!,       // publishable key — server-side only
  revalidate: 60,                      // seconds; every read declares it
});
```

Reads are tagged (`cms:site`, `cms:index`, `cms:post:<slug>`) so the
revalidation webhook can invalidate one page instead of a deployment.

**Errors are typed and loud.** Only `getPost` returns `null`, and only for a
real 404. A 401 throws — otherwise a revoked key renders an empty blog and a
crawler indexes it that way.

```ts
import { isCmsError } from "@letternerd/sdk";

try {
  await cms.listPosts();
} catch (error) {
  if (isCmsError(error) && error.retryable) { /* back off */ }
  throw error;
}
```

## 2. A post page

```tsx
// app/blog/[slug]/page.tsx
import { notFound } from "next/navigation";
import { blogPostingLd, breadcrumbLd, faqLd, speakableLd } from "@letternerd/sdk";
import { CmsImage, JsonLd, PostBody, postMetadata } from "@letternerd/sdk/next";
import { toSeoDocument } from "@letternerd/sdk";
import { cms } from "@/lib/cms";

export async function generateStaticParams() {
  const slugs: { slug: string }[] = [];
  for await (const post of cms.listAllPosts({ status: "published" })) {
    slugs.push({ slug: post.slug });
  }
  return slugs;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, site] = await Promise.all([cms.getPost(slug), cms.getSite()]);
  if (!post) return {};
  return postMetadata(post, site);
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, site] = await Promise.all([cms.getPost(slug), cms.getSite()]);
  if (!post) notFound();

  const doc = toSeoDocument(post);

  return (
    <article>
      <JsonLd
        data={[
          blogPostingLd(doc, site),
          faqLd(doc),
          speakableLd(doc),
          breadcrumbLd(
            [
              { name: "Home", path: "/" },
              { name: "Blog", path: site.blogBasePath },
              { name: post.title, path: `${site.blogBasePath}/${post.slug}` },
            ],
            site,
          ),
        ]}
      />
      <h1>{post.title}</h1>
      {post.coverImage ? <CmsImage media={post.coverImage} priority /> : null}
      <PostBody post={post} />
    </article>
  );
}
```

`<PostBody>` renders HTML that was sanitised in the CMS by `rehype-sanitize` at
publish time. **Do not re-sanitise it.** A second pass strips the `cms-*` class
names the article styles are written against and the heading `id`s the FAQ
JSON-LD points at — the text survives, so it passes review, and the page ships
unstyled with dead anchors.

## 3. The four one-line route files

```ts
// app/sitemap.xml/route.ts
import { createBlogSitemapRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createBlogSitemapRoute(cms);
```

```ts
// app/robots.txt/route.ts
import { createRobotsRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createRobotsRoute(cms, { aiCrawlers: "allow" });
```

```ts
// app/rss.xml/route.ts
import { createFeedRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createFeedRoute(cms, "rss");
```

```ts
// app/llms.txt/route.ts        (and app/llms-full.txt/route.ts)
import { createLlmsTxtRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createLlmsTxtRoute(cms);
```

Also available: `createSitemapIndexRoute`, `createLlmsFullTxtRoute` (streamed —
it never buffers the whole corpus), `createPostMarkdownRoute` for
`/blog/[slug].md`, and `createFeedRoute(cms, "atom" | "json")`.

### Revalidation webhook

```ts
// app/api/cms/revalidate/route.ts
import { createRevalidateWebhookRoute } from "@letternerd/sdk/next";
export const POST = createRevalidateWebhookRoute({ secret: process.env.CMS_WEBHOOK_SECRET! });
```

It verifies an HMAC-SHA256 over the **raw** body, with a signed timestamp and a
five-minute window, compared with `timingSafeEqual`. An unsigned request is a
401 and purges nothing: an open revalidation endpoint is a public URL that
empties your cache in a loop.

### Redirects

```js
// next.config.mjs
import { cmsRedirects } from "@letternerd/sdk/next";
import { cms } from "./lib/cms.js";

export default { redirects: cmsRedirects(cms) };
```

Renames recorded by the CMS become 301s without anyone remembering to write
them.

## 4. Dropping into a site that already has `lib/posts.ts`

If `app/blog/**` already reads through a `Post` interface with
`getAllPosts` / `getPostBySlug` / `getAllSlugs`, replace the body of that one
file and change nothing else:

```ts
// lib/posts.ts
import { createCmsClient } from "@letternerd/sdk";
import { createLegacyApi, type LegacyPost } from "@letternerd/sdk/legacy";

const cms = createCmsClient({
  baseUrl: process.env.CMS_API_URL!,
  key: process.env.CMS_API_KEY!,
});

export type Post = LegacyPost;
export type PostMeta = Omit<Post, "content">;

export const { getAllPosts, getPostBySlug, getAllSlugs } = createLegacyApi(cms, {
  defaultAuthor: "SpendTab Team",
});
```

Same field names, same types, same newest-first ordering, same `null` for a
missing slug. `getAllPosts` fetches each body by default so the returned objects
really are `Post`s; pass `{ hydrate: false }` on a large site and read bodies on
the detail page instead.

## Notes

- **The client never builds a canonical URL.** The API returns `canonicalUrl`
  fully formed and the SDK passes it through to every surface — head, sitemap,
  feed `guid`, JSON-LD `@id`. Assembling one client-side is how canonical drift
  starts.
- **`@cms/seo` is inlined**, not a dependency: the SDK fetches and adapts, and
  no SEO logic is reimplemented here.
- `logCrawlerHit` is fire-and-forget and never throws into a render.

## Security

- **The API key only travels over HTTPS.** `createCmsClient` and `npx @letternerd/sdk init`
  both refuse a plain `http://` base or studio URL, except for `localhost`. (0.1.1)
- **`init` only writes inside the project.** A studio's install plan is validated before
  anything touches disk: no absolute paths, no `..`, nothing under `.git`, `node_modules`
  or `.env*`; one bad entry and nothing at all is written. (0.1.1)
