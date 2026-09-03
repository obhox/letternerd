/**
 * Every snippet on the install page, built from this site's real settings.
 *
 * The SDK's own README documents the same seven steps. This module exists to
 * do the one thing a README cannot: substitute the values. `packages/sdk/README.md`
 * has to write `https://studio.example.com/api/v1` and `/blog`; here those are
 * the studio's actual origin and this site's actual `blogBasePath`, so a block
 * can be copied and pasted without being edited first — which is the difference
 * between an install that works on the first try and one that works after
 * someone notices the placeholder.
 *
 * The structure deliberately follows the README's, and where a line is shared
 * it is repeated verbatim. Two documents that describe the same integration in
 * two different ways are two documents to keep in sync, and the one that is
 * wrong is discovered by whoever trusted it.
 *
 * Pure functions with no React and no server imports, so the substitutions are
 * testable on their own — a wrong `baseUrl` in a curl command is exactly the
 * kind of mistake that reads fine and fails silently.
 */

export interface InstallValues {
  /** Display name of this site, for the legacy adapter's default byline. */
  siteName: string;
  /** Where this studio is served from, e.g. `https://studio.example.com`. */
  studioOrigin: string;
  /** The consuming site's own origin. Every canonical URL is built from it. */
  baseUrl: string;
  /** Root-relative, no trailing slash, e.g. `/blog`. */
  blogBasePath: string;
  /** BCP-47, e.g. `en-GB`. */
  locale: string;
  /**
   * A slug that really is published on this site, for the verification
   * commands. `null` when nothing is published yet — the checks then use an
   * obvious stand-in and the page says so.
   */
  sampleSlug: string | null;
}

/**
 * The one value that cannot be filled in.
 *
 * Keys are stored as a SHA-256 digest and returned exactly once, so no page
 * that renders later can know one. Shaped like a real key, and loud enough
 * that it cannot be mistaken for one.
 */
export const KEY_PLACEHOLDER = "cms_sk_PASTE_YOUR_READ_KEY_HERE";

const FALLBACK_SLUG = "your-post-slug";

/** `https://studio.example.com/api/v1` — what `baseUrl` in the client wants. */
export function apiUrl(values: Pick<InstallValues, "studioOrigin">): string {
  return `${trimSlash(values.studioOrigin)}/api/v1`;
}

/** The blog's folder under `app/`, e.g. `app/blog` — the URL is the path. */
export function blogAppDir(blogBasePath: string): string {
  const path = trimSlash(blogBasePath);
  return path === "" ? "app" : `app${path}`;
}

export function sampleSlugOf(values: InstallValues): string {
  return values.sampleSlug ?? FALLBACK_SLUG;
}

/** `https://site.com/blog/some-post`, with no doubled slashes. */
export function postUrl(values: InstallValues): string {
  return `${trimSlash(values.baseUrl)}${trimSlash(values.blogBasePath)}/${sampleSlugOf(values)}`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/* ------------------------------------------------------------------ 2 --- */

/**
 * Installing it.
 *
 * The package is `private: true` and has never been published, so the registry
 * command in most integration guides would simply 404. Both forms below are
 * real; the `file:` one resolves through `dist/`, which is why the build comes
 * first.
 */
export function installSnippet(): string {
  return [
    "# @obhox/cms-sdk is not on npm yet, so there is no registry install.",
    "# It builds to dist/, and a file: dependency resolves through dist/ —",
    "# so build it once in the CMS checkout first:",
    "pnpm --filter @obhox/cms-sdk build",
    "",
    "# Then, from your site, depend on the checkout by path:",
    "pnpm add @obhox/cms-sdk@file:../cms/packages/sdk",
    "",
    "# Or, if your site already lives in this pnpm workspace:",
    "pnpm add @obhox/cms-sdk@workspace:*",
  ].join("\n");
}

/* ------------------------------------------------------------------ 3 --- */

export function envSnippet(values: InstallValues): string {
  return [
    "# .env.local — CMS_API_KEY is a secret; it belongs here, not in NEXT_PUBLIC_*.",
    `CMS_API_URL=${apiUrl(values)}`,
    `CMS_API_KEY=${KEY_PLACEHOLDER}`,
    "CMS_WEBHOOK_SECRET=shown-once-when-you-register-the-webhook",
  ].join("\n");
}

export function clientSnippet(values: InstallValues): string {
  return `// lib/cms.ts
import { createCmsClient } from "@obhox/cms-sdk";

export const cms = createCmsClient({
  baseUrl: process.env.CMS_API_URL!,   // ${apiUrl(values)}
  key: process.env.CMS_API_KEY!,       // ${KEY_PLACEHOLDER.slice(0, 7)}… — server-side only
  revalidate: 60,                      // seconds; every read declares it
});`;
}

/* ------------------------------------------------------------------ 4 --- */

export function postPageSnippet(values: InstallValues): string {
  return `// ${blogAppDir(values.blogBasePath)}/[slug]/page.tsx
import { notFound } from "next/navigation";
import { blogPostingLd, breadcrumbLd, faqLd, speakableLd } from "@obhox/cms-sdk";
import { CmsImage, JsonLd, PostBody, postMetadata } from "@obhox/cms-sdk/next";
import { toSeoDocument } from "@obhox/cms-sdk";
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
              // site.blogBasePath is "${trimSlash(values.blogBasePath)}" and site.locale is "${values.locale}",
              // read from the API rather than hard-coded here.
              { name: "Blog", path: site.blogBasePath },
              { name: post.title, path: \`\${site.blogBasePath}/\${post.slug}\` },
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
}`;
}

/* ------------------------------------------------------------------ 5 --- */

export interface FileSnippet {
  /** Where the file goes. In the app router the folder *is* the URL. */
  path: string;
  /** The URL it serves on the consuming domain. */
  serves: string;
  code: string;
}

export function routeSnippets(values: InstallValues): FileSnippet[] {
  const origin = trimSlash(values.baseUrl);
  return [
    {
      path: "app/sitemap.xml/route.ts",
      serves: `${origin}/sitemap.xml`,
      code: `// app/sitemap.xml/route.ts
import { createBlogSitemapRoute } from "@obhox/cms-sdk/next";
import { cms } from "@/lib/cms";
export const GET = createBlogSitemapRoute(cms);`,
    },
    {
      path: "app/robots.txt/route.ts",
      serves: `${origin}/robots.txt`,
      code: `// app/robots.txt/route.ts
import { createRobotsRoute } from "@obhox/cms-sdk/next";
import { cms } from "@/lib/cms";
export const GET = createRobotsRoute(cms, { aiCrawlers: "allow" });`,
    },
    {
      path: "app/rss.xml/route.ts",
      serves: `${origin}/rss.xml`,
      code: `// app/rss.xml/route.ts
import { createFeedRoute } from "@obhox/cms-sdk/next";
import { cms } from "@/lib/cms";
export const GET = createFeedRoute(cms, "rss");`,
    },
    {
      path: "app/llms.txt/route.ts",
      serves: `${origin}/llms.txt`,
      code: `// app/llms.txt/route.ts
import { createLlmsTxtRoute } from "@obhox/cms-sdk/next";
import { cms } from "@/lib/cms";
export const GET = createLlmsTxtRoute(cms);`,
    },
  ];
}

/**
 * The markdown alternate, which needs a rewrite rather than a folder.
 *
 * `pageMetadataFields` advertises `<canonical>.md` in every post's `<head>`, so
 * the URL is fixed at `${blogBasePath}/<slug>.md`. A Next segment is dynamic
 * only when the *whole* folder name is bracketed, so `[slug].md` is a literal
 * directory, and a `route.ts` cannot share `[slug]/` with `page.tsx`. An
 * `afterFiles` rewrite — the plain array form — runs before dynamic routes and
 * is what makes the advertised URL resolve.
 */
export function markdownRouteSnippet(values: InstallValues): FileSnippet {
  const blogPath = trimSlash(values.blogBasePath);
  return {
    path: "app/api/cms/markdown/[slug]/route.ts",
    serves: `${trimSlash(values.baseUrl)}${blogPath}/${sampleSlugOf(values)}.md`,
    code: `// app/api/cms/markdown/[slug]/route.ts
import { createPostMarkdownRoute } from "@obhox/cms-sdk/next";
import { cms } from "@/lib/cms";
export const GET = createPostMarkdownRoute(cms);`,
  };
}

/** The rewrite that puts the handler above on the URL the `<head>` advertises. */
export function markdownRewriteSnippet(values: InstallValues): FileSnippet {
  const blogPath = trimSlash(values.blogBasePath);
  return {
    path: "next.config.mjs",
    serves: `${trimSlash(values.baseUrl)}${blogPath}/<slug>.md`,
    code: `// next.config.mjs
import { cmsRedirects } from "@obhox/cms-sdk/next";
import { cms } from "./lib/cms.js";

export default {
  // Renames recorded by the CMS become 301s without anyone writing them.
  redirects: cmsRedirects(cms),
  // The plain array form runs after static files and *before* dynamic routes,
  // so it wins over ${blogAppDir(values.blogBasePath)}/[slug]/page.tsx for a slug ending in .md.
  async rewrites() {
    return [{ source: "${blogPath}/:slug.md", destination: "/api/cms/markdown/:slug" }];
  },
};`,
  };
}

/* ------------------------------------------------------------------ 6 --- */

export function webhookRouteSnippet(values: InstallValues): FileSnippet {
  return {
    path: "app/api/cms/revalidate/route.ts",
    serves: `${trimSlash(values.baseUrl)}/api/cms/revalidate`,
    code: `// app/api/cms/revalidate/route.ts
import { createRevalidateWebhookRoute } from "@obhox/cms-sdk/next";
export const POST = createRevalidateWebhookRoute({ secret: process.env.CMS_WEBHOOK_SECRET! });`,
  };
}

/* ------------------------------------------------------------------ 7 --- */

export function legacySnippet(values: InstallValues): string {
  return `// lib/posts.ts — replace this file's body; app${trimSlash(values.blogBasePath)}/** is untouched.
import { createCmsClient } from "@obhox/cms-sdk";
import { createLegacyApi, type LegacyPost } from "@obhox/cms-sdk/legacy";

const cms = createCmsClient({
  baseUrl: process.env.CMS_API_URL!,   // ${apiUrl(values)}
  key: process.env.CMS_API_KEY!,
});

export type Post = LegacyPost;
export type PostMeta = Omit<Post, "content">;

export const { getAllPosts, getPostBySlug, getAllSlugs } = createLegacyApi(cms, {
  defaultAuthor: ${JSON.stringify(values.siteName)},
});`;
}

/* --------------------------------------------------- check it worked --- */

export interface VerificationCheck {
  id: string;
  title: string;
  command: string;
  /** What passing looks like. One line. */
  expect: string;
  /** What a failure actually means — the part a command alone cannot say. */
  failure: string;
}

/**
 * The section a README cannot write, because it does not know the domain.
 *
 * Every command runs against the consuming site, not against this studio, and
 * every one of them fails in a specific way that means a specific thing. A
 * command with no failure note tells someone that something is wrong; the note
 * tells them which file to open.
 */
export function verificationChecks(values: InstallValues): VerificationCheck[] {
  const origin = trimSlash(values.baseUrl);
  const url = postUrl(values);

  return [
    {
      id: "server-rendered",
      title: "The article is in the HTML, without JavaScript",
      command: `curl -s ${url} | grep -c '<article'`,
      expect: "1 or more.",
      failure:
        "0 means the HTML leaving your server has no article element in it. Either the page is a " +
        "client component fetching on mount — a crawler sees the empty shell and nothing else — or " +
        "getPost returned null and your fallback rendered instead. Server-rendered content on your " +
        "own domain is the entire premise; if this one is 0, nothing below matters.",
    },
    {
      id: "artifacts",
      title: "All four artifacts answer 200 from your domain",
      command: `for p in /sitemap.xml /robots.txt /rss.xml /llms.txt; do
  printf '%s  %s\\n' "$(curl -s -o /dev/null -w '%{http_code}' ${origin}$p)" "$p"
done`,
      expect: "200 on all four.",
      failure:
        "404 means the route file is missing or misfiled — in the app router the folder name is the " +
        "URL, so app/sitemap.xml/route.ts and nothing else serves /sitemap.xml. 500 usually means the " +
        "client threw: a 401 from a revoked or mistyped CMS_API_KEY surfaces here first, because these " +
        "routes read at request time while a cached page may still be serving.",
    },
    {
      id: "own-domain",
      title: "They are served from your origin, not from the studio",
      command: `curl -s ${origin}/sitemap.xml | head -5
curl -s ${origin}/robots.txt`,
      expect: `Every <loc> starts with ${origin}, and robots.txt names ${origin}/sitemap.xml.`,
      failure:
        `A <loc> pointing at ${trimSlash(values.studioOrigin)} means baseUrl in Settings is set to this ` +
        "studio rather than to your site, and every canonical URL the CMS emits is wrong with it. " +
        "robots.txt is only ever read from the origin it governs, and a sitemap listing URLs on a host " +
        "that does not serve them is ignored — which is why all four are routes in your app rather than " +
        "links back to the CMS.",
    },
    {
      id: "crawler",
      title: "An AI crawler gets HTML, not a JavaScript shell",
      command: `curl -sA "GPTBot" ${url} | grep -c '<article'
curl -sA "GPTBot" -o /dev/null -w '%{http_code}\\n' ${origin}/llms.txt`,
      expect: "1 or more, then 200.",
      failure:
        "0 with a bot user-agent but a pass on the check above means something is serving crawlers " +
        "differently — usually a CDN or WAF bot rule, which is a platform setting rather than anything " +
        "in the SDK. A 403 on llms.txt is the same cause. If you passed aiCrawlers: \"block\" to " +
        "createRobotsRoute, that is a robots.txt directive and does not change what this request returns.",
    },
    {
      id: "canonical",
      title: "The canonical points at your origin",
      command: `curl -s ${url} | grep -o '<link rel="canonical"[^>]*>'`,
      expect: `href="${url}".`,
      failure:
        `A canonical on ${trimSlash(values.studioOrigin)} means the CMS's baseUrl is wrong — the API ` +
        "returns canonicalUrl fully formed and the SDK passes it through unchanged, so a wrong value " +
        "there lands identically in the head, the sitemap, the feed guid and the JSON-LD @id at once. " +
        "Nothing is missing means generateMetadata is not exported from the page file.",
    },
    {
      id: "markdown",
      title: "The .md alternate resolves",
      command: `curl -s -o /dev/null -w '%{http_code} %{content_type}\\n' ${url}.md`,
      expect: "200 text/markdown; charset=utf-8.",
      failure:
        "404 means either the rewrite is missing from next.config.mjs or the handler is not where the " +
        "rewrite points. Every post's head advertises this URL, so a 404 here is a broken link the CMS " +
        "itself published. Getting HTML back instead of markdown means the request fell through to the " +
        "post page, which is the dynamic route matching a slug that ends in .md.",
    },
    {
      id: "key",
      title: "The key itself works",
      command: `curl -s -H "Authorization: Bearer $CMS_API_KEY" ${apiUrl(values)}/site`,
      expect: `JSON whose baseUrl is ${origin}.`,
      failure:
        "401 covers malformed, unknown, revoked and expired keys with one identical answer, on purpose " +
        "— check the prefix first, then whether the key is still listed above. 403 means the key was " +
        "sent from a browser: a cms_sk_ key with an Origin header is refused, which is how a leak into " +
        "client code is found before someone else finds it.",
    },
  ];
}
