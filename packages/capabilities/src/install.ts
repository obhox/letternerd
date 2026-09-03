import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { defineCapability } from "@cms/core";
import * as schema from "@cms/db/schema";
import { requireSiteRow } from "./shared";

/**
 * The integration, generated once for both the people and the agents.
 *
 * Two audiences want the same seven files. A person opens the studio's install
 * guide and copies blocks; an agent connected over MCP calls `get_install_plan`
 * and writes them. If those two surfaces each generated their own text they
 * would drift, and the drift would be silent: the agent writes something
 * subtly unlike what the guide documents, both look plausible in review, and
 * the discrepancy surfaces as a broken build in a customer's repository weeks
 * later. So the generator lives here, in the capability layer that every
 * transport already dispatches through, and the studio page re-exports it.
 *
 * What this module does that a README cannot is substitute the values.
 * `packages/sdk/README.md` has to write `https://studio.example.com/api/v1`
 * and `/blog`; here those are the studio's actual origin and this site's
 * actual `blogBasePath`, so a block can be pasted without being edited first —
 * which is the difference between an install that works on the first try and
 * one that works after someone notices the placeholder.
 *
 * The structure deliberately follows the README's, and where a line is shared
 * it is repeated verbatim. Two documents that describe the same integration in
 * two different ways are two documents to keep in sync, and the one that is
 * wrong is discovered by whoever trusted it.
 *
 * Everything above `getInstallPlan` is a pure function of its arguments: no
 * React, no database, no environment. That is what lets the studio import this
 * module from a server component and lets the substitutions be tested on their
 * own — a wrong `baseUrl` in a curl command is exactly the kind of mistake
 * that reads fine and fails silently.
 */

/* --- BEGIN SHARED GENERATOR --------------------------------------------- *
 * Mirrored byte-for-byte in `packages/sdk/src/cli/snippets.ts`, so that the
 * `npx @letternerd/sdk init` fallback writes exactly what this studio's guide
 * documents. It cannot be imported from there: `@letternerd/sdk` is published
 * and `@cms/capabilities` is private, so a dependency in that direction would
 * be unresolvable on a customer's machine. `install.test.ts` compares the two
 * regions and fails the build when they diverge — which is the only thing that
 * makes a copy safe.
 *
 * Everything between these markers must stay import-free and pure.
 * ------------------------------------------------------------------------- */

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
    "# @letternerd/sdk is not on npm yet, so there is no registry install.",
    "# It builds to dist/, and a file: dependency resolves through dist/ —",
    "# so build it once in the CMS checkout first:",
    "pnpm --filter @letternerd/sdk build",
    "",
    "# Then, from your site, depend on the checkout by path:",
    "pnpm add @letternerd/sdk@file:../cms/packages/sdk",
    "",
    "# Or, if your site already lives in this pnpm workspace:",
    "pnpm add @letternerd/sdk@workspace:*",
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
import { createCmsClient } from "@letternerd/sdk";

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
import { createBlogSitemapRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createBlogSitemapRoute(cms);`,
    },
    {
      path: "app/robots.txt/route.ts",
      serves: `${origin}/robots.txt`,
      code: `// app/robots.txt/route.ts
import { createRobotsRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createRobotsRoute(cms, { aiCrawlers: "allow" });`,
    },
    {
      path: "app/rss.xml/route.ts",
      serves: `${origin}/rss.xml`,
      code: `// app/rss.xml/route.ts
import { createFeedRoute } from "@letternerd/sdk/next";
import { cms } from "@/lib/cms";
export const GET = createFeedRoute(cms, "rss");`,
    },
    {
      path: "app/llms.txt/route.ts",
      serves: `${origin}/llms.txt`,
      code: `// app/llms.txt/route.ts
import { createLlmsTxtRoute } from "@letternerd/sdk/next";
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
import { createPostMarkdownRoute } from "@letternerd/sdk/next";
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
import { cmsRedirects } from "@letternerd/sdk/next";
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
import { createRevalidateWebhookRoute } from "@letternerd/sdk/next";
export const POST = createRevalidateWebhookRoute({ secret: process.env.CMS_WEBHOOK_SECRET! });`,
  };
}

/* ------------------------------------------------------------------ 7 --- */

export function legacySnippet(values: InstallValues): string {
  return `// lib/posts.ts — replace this file's body; app${trimSlash(values.blogBasePath)}/** is untouched.
import { createCmsClient } from "@letternerd/sdk";
import { createLegacyApi, type LegacyPost } from "@letternerd/sdk/legacy";

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

/* ----------------------------------------------------- the plan --- */

/**
 * The published package and the tag a consuming site should install from.
 *
 * `0.1.0` ships under `next` rather than `latest` on purpose: the API is still
 * moving, and a site that pinned `latest` would be upgraded into a breaking
 * change by a lockfile refresh it did not read.
 */
export const SDK_PACKAGE = "@letternerd/sdk";
export const SDK_DIST_TAG = "next";

export type PackageManager = "pnpm" | "npm" | "yarn";

/** The one command that adds the SDK, in whichever manager the project uses. */
export function installCommand(packageManager: PackageManager): string {
  const spec = `${SDK_PACKAGE}@${SDK_DIST_TAG}`;
  switch (packageManager) {
    case "npm":
      return `npm install ${spec}`;
    case "yarn":
      return `yarn add ${spec}`;
    default:
      return `pnpm add ${spec}`;
  }
}

/**
 * One file an agent should write, complete enough to write without asking.
 *
 * `contents` is the whole file, not a fragment to splice: an agent handed a
 * fragment has to decide where it goes, and that decision is exactly where an
 * unattended install goes wrong. `overwrite` is on every entry and is always
 * `false` — it is stated per file rather than once in prose because a field is
 * read by a caller that skims and a paragraph is not.
 */
export interface PlanFile {
  /** Relative to the project root, using the site's real blog base path. */
  path: string;
  /** The complete file. Write it as-is. */
  contents: string;
  /** Why this file exists, in one line. */
  purpose: string;
  /**
   * Always false. Nothing here is worth more than whatever a project already
   * has at the same path: a site that already owns `lib/cms.ts` or a post page
   * has made decisions this plan cannot see, and replacing them silently is a
   * worse outcome than an install that stops and says which file it skipped.
   */
  overwrite: boolean;
}

/** One line of `.env.local`, and whether this API is allowed to fill it in. */
export interface PlanEnvVar {
  name: string;
  /** Filled in from this deployment, or `null` when only a human can supply it. */
  value: string | null;
  /** What to write while `value` is null. Never a working credential. */
  placeholder: string | null;
  secret: boolean;
  note: string;
}

export interface PlanEnv {
  path: string;
  variables: PlanEnvVar[];
  /** The same variables as a pasteable block, byte-identical to the guide's. */
  snippet: string;
}

/**
 * The one change that is an edit rather than a new file.
 *
 * Every other artifact in this plan is a file that either exists or does not.
 * A Next project always has a config, so this is described as a merge and
 * carries the parsed rewrite as data — an agent that has read the existing
 * config can add one array element rather than reasoning about a diff.
 */
export interface PlanNextConfig {
  path: string;
  /** Always true: merge into the existing config, never replace it. */
  merge: boolean;
  instructions: string[];
  rewrite: { source: string; destination: string };
  /** What the whole file looks like when a project genuinely has none. */
  example: string;
}

export interface InstallPlan {
  framework: "next-app-router";
  site: {
    name: string;
    baseUrl: string;
    /** What the plan actually used, which the caller may have overridden. */
    blogBasePath: string;
    locale: string;
    /** A slug that really is published, for the verification commands. */
    sampleSlug: string | null;
  };
  studio: { origin: string; apiUrl: string };
  install: {
    packageManager: PackageManager;
    command: string;
    package: string;
    tag: string;
  };
  files: PlanFile[];
  env: PlanEnv;
  nextConfig: PlanNextConfig;
  verify: VerificationCheck[];
  notes: string[];
}

/**
 * Every file the integration needs, in the order they make sense to write.
 *
 * `next.config.mjs` is in this list rather than only in `nextConfig` because a
 * project without one is a real case and the file is then simply missing. It
 * carries the same `overwrite: false` as the rest, which is what makes the
 * common case — a project that already has a config — resolve correctly: the
 * write is skipped and the merge instructions apply instead.
 */
export function planFiles(values: InstallValues): PlanFile[] {
  const markdown = markdownRouteSnippet(values);
  const rewrite = markdownRewriteSnippet(values);
  const webhook = webhookRouteSnippet(values);
  const blogDir = blogAppDir(values.blogBasePath);

  return [
    {
      path: "lib/cms.ts",
      contents: clientSnippet(values),
      purpose:
        "The client every other file imports. Reads CMS_API_URL and CMS_API_KEY, and declares " +
        "the revalidate window that backstops the webhook.",
      overwrite: false,
    },
    {
      path: `${blogDir}/[slug]/page.tsx`,
      contents: postPageSnippet(values),
      purpose:
        `The post page. In the app router the folder is the URL, so this path follows the site's ` +
        `blogBasePath of "${trimSlash(values.blogBasePath) || "/"}". It renders on the server: the ` +
        `article is in the HTML before any JavaScript runs, which is the point of the whole install.`,
      overwrite: false,
    },
    ...routeSnippets(values).map((file) => ({
      path: file.path,
      contents: file.code,
      purpose: `Serves ${file.serves} from the consuming domain rather than from the studio.`,
      overwrite: false,
    })),
    {
      path: markdown.path,
      contents: markdown.code,
      purpose:
        `Serves ${markdown.serves}. Every post's <head> already advertises a .md rendition, so ` +
        `this handler plus the rewrite in \`nextConfig\` is what stops the CMS publishing a broken link.`,
      overwrite: false,
    },
    {
      path: rewrite.path,
      contents: rewrite.code,
      purpose:
        "Only for a project that has no Next config at all. Almost every project has one — when " +
        "this file exists, skip it and merge `nextConfig` into the existing config instead.",
      overwrite: false,
    },
    {
      path: webhook.path,
      contents: webhook.code,
      purpose:
        `Receives publish events at ${webhook.serves} and purges the affected cache tags. Verifies ` +
        `an HMAC-SHA256 over the raw body before doing anything; an unsigned request purges nothing.`,
      overwrite: false,
    },
  ];
}

/**
 * The environment, with one value deliberately missing.
 *
 * `CMS_API_URL` is this deployment's real API and is filled in. `CMS_API_KEY`
 * is not, and cannot be: keys are stored as a SHA-256 digest and the plaintext
 * exists exactly once, in the response to `create_api_key`. A read capability
 * that minted one as a convenience would turn every plan request into a live
 * credential, issued without anyone deciding to — so this returns a placeholder
 * and says who can replace it.
 */
export function planEnv(values: InstallValues): PlanEnv {
  return {
    path: ".env.local",
    variables: [
      {
        name: "CMS_API_URL",
        value: apiUrl(values),
        placeholder: null,
        secret: false,
        note: "This studio's content API. Filled in; nothing to decide.",
      },
      {
        name: "CMS_API_KEY",
        value: null,
        placeholder: KEY_PLACEHOLDER,
        secret: true,
        note:
          "Not returned by this tool, ever. A `read` key — the cms_sk_ kind — is what a " +
          "server-rendering site needs. `create_api_key` mints one and returns the plaintext " +
          "exactly once, it is owner-only, and issuing a credential is a decision for a person: " +
          "ask, do not call it. Server-side only — a cms_sk_ key sent with an Origin header is " +
          "refused with a 403, which is how a leak into client code is found.",
      },
      {
        name: "CMS_WEBHOOK_SECRET",
        value: null,
        placeholder: "shown-once-when-you-register-the-webhook",
        secret: true,
        note:
          "Shown once, when an owner registers the webhook under Settings → Webhooks. Until then " +
          "the revalidation route is wired but has nothing to verify against.",
      },
    ],
    snippet: envSnippet(values),
  };
}

export function planNextConfig(values: InstallValues): PlanNextConfig {
  const blogPath = trimSlash(values.blogBasePath);
  const rewrite = markdownRewriteSnippet(values);
  return {
    path: rewrite.path,
    merge: true,
    instructions: [
      "This is a merge into the project's existing Next config, not a replacement. Read the file first.",
      `Add { source: "${blogPath}/:slug.md", destination: "/api/cms/markdown/:slug" } to the array returned by \`rewrites()\`, creating \`rewrites()\` only if the config has none.`,
      "The plain array form runs after static files and before dynamic routes, which is what makes " +
        `it win over ${blogAppDir(values.blogBasePath)}/[slug]/page.tsx for a slug ending in .md. ` +
        "The { beforeFiles, afterFiles, fallback } object form does not, unless the entry is in `afterFiles`.",
      "`redirects: cmsRedirects(cms)` is optional and separate: it turns renames recorded in the CMS " +
        "into 301s without anyone writing them. Leave an existing `redirects` alone rather than replacing it.",
    ],
    rewrite: { source: `${blogPath}/:slug.md`, destination: "/api/cms/markdown/:slug" },
    example: rewrite.code,
  };
}

/**
 * What this build of the CMS does not do, said out loud.
 *
 * An install guide that omits its own gaps produces a customer who believes
 * publishing purges their cache, discovers over a week that it does not, and
 * blames the SDK. Each of these is cheap to state and expensive to find.
 */
export function planNotes(values: InstallValues, requestedBlogBasePath?: string): string[] {
  const notes = [
    "Outbound webhook delivery is NOT implemented in this build. The subscription is stored and " +
      "nothing posts to it, so publishing does not yet purge a consuming site's cache. Until it " +
      "lands, published changes appear within the `revalidate` window in lib/cms.ts (60s by " +
      "default). Wire the route now anyway: it is three lines and nothing has to change when " +
      "delivery ships.",
    "No API key is included and none can be. Ask a site owner to mint a `read` key; the plaintext " +
      "is shown exactly once and is not recoverable afterwards.",
    "Every path is relative to the project root and every file is `overwrite: false`. Read the " +
      "project before writing: a site that already has lib/cms.ts or a post page has made choices " +
      "this plan cannot see.",
    "Next.js App Router only. There is no Pages Router variant of these route handlers, and the " +
      "components are React Server Components.",
    "`PostBody` renders HTML already sanitised in the CMS at publish time. Do not sanitise it " +
      "again — a second pass strips the cms-* class names the styles are written against and the " +
      "heading ids the FAQ JSON-LD points at, so the text survives review and the page ships " +
      "unstyled with dead anchors.",
  ];

  if (values.sampleSlug === null) {
    notes.push(
      `Nothing is published on this site yet, so the verification commands address ` +
        `${postUrl(values)}, which will 404 until a post exists. Publish one first, or substitute a slug.`,
    );
  }

  if (requestedBlogBasePath !== undefined && trimSlash(requestedBlogBasePath) !== trimSlash(values.blogBasePath)) {
    notes.push(
      `blogBasePath was overridden to "${trimSlash(values.blogBasePath)}" for this plan, but the ` +
        `site's setting is "${trimSlash(requestedBlogBasePath)}". Canonical URLs, the sitemap, the ` +
        `feed and the JSON-LD @id are all built from the site's setting, so leaving them different ` +
        `publishes canonicals that point at pages the site does not serve. Change it in Settings instead.`,
    );
  }

  return notes;
}

export interface BuildPlanOptions {
  packageManager?: PackageManager;
  /** The site's configured path, when the caller asked for a different one. */
  configuredBlogBasePath?: string;
}

/** The whole plan, from values a caller already holds. Pure. */
export function buildInstallPlan(
  values: InstallValues,
  options: BuildPlanOptions = {},
): InstallPlan {
  const packageManager = options.packageManager ?? "pnpm";
  return {
    framework: "next-app-router",
    site: {
      name: values.siteName,
      baseUrl: trimSlash(values.baseUrl),
      blogBasePath: trimSlash(values.blogBasePath),
      locale: values.locale,
      sampleSlug: values.sampleSlug,
    },
    studio: { origin: trimSlash(values.studioOrigin), apiUrl: apiUrl(values) },
    install: {
      packageManager,
      command: installCommand(packageManager),
      package: SDK_PACKAGE,
      tag: SDK_DIST_TAG,
    },
    files: planFiles(values),
    env: planEnv(values),
    nextConfig: planNextConfig(values),
    verify: verificationChecks(values),
    notes: planNotes(values, options.configuredBlogBasePath),
  };
}

/* --- END SHARED GENERATOR ----------------------------------------------- */

/**
 * Where this studio is served from.
 *
 * Capabilities in this package take everything through `services`, and this is
 * the second deliberate exception after the analytics cipher, for the same
 * reason: the studio's own origin is a property of the deployment rather than
 * of a request, and threading it through `CapabilityServices` would change a
 * structure four transports construct in order to carry one constant. The seam
 * for tests is the `env` parameter, which every test uses.
 *
 * Null rather than a throw when it is unset: a plan with a placeholder API URL
 * and a note saying so is more useful than a 500, and the studio's own env
 * schema already requires the variable in any real deployment.
 */
export function readStudioOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env["CMS_STUDIO_URL"]?.trim();
  return raw ? trimSlash(raw) : null;
}

const STUDIO_ORIGIN_FALLBACK = "https://studio.example.com";

export const getInstallPlan = defineCapability({
  name: "get_install_plan",
  title: "Get install plan",
  description:
    "Everything an agent needs to install the Letternerd SDK into a Next.js App Router project, " +
    "filled in with this site's real API URL, blog base path and locale. Returns FILES TO WRITE: " +
    "each entry in `files` is a path relative to the project root plus the complete contents of " +
    "that file — lib/cms.ts, the post page, the four artifact routes, the markdown route and the " +
    "revalidation webhook — alongside the package-manager command, the .env.local variables, the " +
    "next.config rewrite to merge into the existing config, and curl checks to run afterwards. " +
    "Read the project before writing anything: every file is marked `overwrite: false` and none " +
    "of them may replace a file that already exists. Never returns an API key and never mints " +
    "one — `create_api_key` does that, it is owner-only, and a person has to decide to. " +
    "Read-only: this changes nothing on the site.",
  input: z.object({
    /**
     * Present and required-by-default rather than absent, so the answer to
     * "does this support my framework?" is in the schema an agent already
     * reads rather than in prose it may not.
     */
    framework: z.literal("next-app-router").default("next-app-router"),
    /**
     * An override for a project whose blog does not live where the site says.
     * It changes the paths in this plan and nothing else — the CMS still builds
     * canonicals from its own setting, which is why disagreeing earns a note.
     */
    blogBasePath: z
      .string()
      .regex(/^\/[a-z0-9/-]*$/, "Must be root-relative and lower-case, e.g. /blog.")
      .optional(),
    packageManager: z.enum(["pnpm", "npm", "yarn"]).default("pnpm"),
  }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/install-plan" },
  handler: async (input, { actor, services }): Promise<InstallPlan> => {
    const site = await requireSiteRow(services.db, actor.siteId);

    /**
     * One slug that really is published, so the curl commands address a page
     * that exists. A verification section whose examples 404 teaches nothing —
     * and worse, teaches that a correct install looks broken.
     */
    const [published] = await services.db
      .select({ slug: schema.documents.slug })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, actor.siteId),
          eq(schema.documents.type, "post"),
          eq(schema.documents.status, "published"),
          isNull(schema.documents.deletedAt),
        ),
      )
      .orderBy(desc(schema.documents.publishedAt))
      .limit(1);

    const values: InstallValues = {
      siteName: site.name,
      studioOrigin: readStudioOrigin() ?? STUDIO_ORIGIN_FALLBACK,
      baseUrl: site.baseUrl,
      blogBasePath: input.blogBasePath ?? site.blogBasePath,
      locale: site.locale,
      sampleSlug: published?.slug ?? null,
    };

    const plan = buildInstallPlan(values, {
      packageManager: input.packageManager,
      configuredBlogBasePath: site.blogBasePath,
    });

    if (readStudioOrigin() === null) {
      plan.notes.push(
        `CMS_STUDIO_URL is not set on this deployment, so CMS_API_URL above is the placeholder ` +
          `${STUDIO_ORIGIN_FALLBACK}/api/v1 rather than a real address. Replace it with this ` +
          `studio's origin before the client will resolve anything.`,
      );
    }

    return plan;
  },
});

export const installCapabilities = [getInstallPlan];
