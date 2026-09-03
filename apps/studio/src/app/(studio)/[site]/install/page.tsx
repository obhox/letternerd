import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@cms/core/roles";
import { PageHeader } from "@cms/ui";
import { env } from "@/env";
import { dispatch, dispatchOrThrow, studioContext } from "@/server/context";
import { CodeBlock } from "@/components/install/code-block";
import { KeyStep, type InstallKeyView } from "@/components/install/key-step";
import { Step, StepNote, Value } from "@/components/install/step";
import { VerifySection } from "@/components/install/verify";
import {
  apiUrl,
  blogAppDir,
  clientSnippet,
  envSnippet,
  installSnippet,
  legacySnippet,
  markdownRewriteSnippet,
  markdownRouteSnippet,
  postPageSnippet,
  routeSnippets,
  webhookRouteSnippet,
  type InstallValues,
} from "@/components/install/snippets";

/**
 * How to point a website at this CMS.
 *
 * `packages/sdk/README.md` documents the same integration and is the source of
 * truth for it; this page follows its order and repeats its code verbatim. What
 * it adds is the part a README cannot have — this site's own origin, blog path
 * and locale substituted into every block, its real API keys listed by prefix,
 * a published slug in the verification commands, and a "check it worked"
 * section that runs against the consuming domain rather than against ours.
 *
 * Readable by any member. Only the key-minting action is owner-gated, because
 * the guide is most useful to the person doing the wiring, who is frequently
 * not the person who owns the site.
 */

export const metadata: Metadata = { title: "Install on your site" };

interface SiteResult {
  name: string;
  baseUrl: string;
  blogBasePath: string;
  locale: string;
}

interface SearchResult {
  documents: { slug: string }[];
}

interface ListApiKeysResult {
  keys: {
    id: string;
    name: string;
    type: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }[];
}

export default async function InstallPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);

  const canManageKeys = can.manageApiKeys(ctx.role);

  const [site, published] = await Promise.all([
    dispatchOrThrow<SiteResult>(ctx, "get_site", {}),
    // One real published slug, so the curl commands below address a page that
    // actually exists. A guide whose examples 404 teaches nothing.
    dispatchOrThrow<SearchResult>(ctx, "search_content", {
      type: "post",
      status: "published",
      limit: 1,
    }),
  ]);

  /**
   * `list_api_keys` is owner-only at the capability, so it is not called at all
   * for an editor — dispatched rather than dispatchOrThrow so that a refusal is
   * a value and this page still renders its other seven steps.
   */
  let keys: InstallKeyView[] = [];
  if (canManageKeys) {
    const result = await dispatch<ListApiKeysResult>(ctx, "list_api_keys", {});
    if (result.ok) {
      keys = result.data.keys
        .filter((key) => key.revokedAt === null)
        .map((key) => ({
          id: key.id,
          name: key.name,
          type: key.type,
          keyPrefix: key.keyPrefix,
          // ISO across the client boundary, so the browser formats the date in
          // the reader's locale rather than the server's.
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        }));
    }
  }

  const values: InstallValues = {
    siteName: site.name,
    studioOrigin: env.CMS_STUDIO_URL,
    baseUrl: site.baseUrl,
    blogBasePath: site.blogBasePath,
    locale: site.locale,
    sampleSlug: published.documents[0]?.slug ?? null,
  };

  const routes = routeSnippets(values);
  const markdownRoute = markdownRouteSnippet(values);
  const markdownRewrite = markdownRewriteSnippet(values);
  const webhook = webhookRouteSnippet(values);

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <PageHeader
        title="Install on your site"
        description={
          <>
            Seven steps to render this site&rsquo;s content on <Value>{values.baseUrl}</Value>, and
            then the part that matters: checking that it actually worked. Every block below is
            already filled in with this site&rsquo;s settings — copy them as they are. The one value
            that cannot be filled in is the API key, which is shown once and never again.
          </>
        }
      />

      <div className="flex flex-col gap-8">
        <Step number={1} id="key" title="Get a key">
          <KeyStep siteSlug={slug} canManageKeys={canManageKeys} keys={keys} />
        </Step>

        <Step number={2} id="install" title="Install the package">
          <StepNote>
            <strong className="font-semibold text-[var(--color-ink)]">
              This package is not published to a registry.
            </strong>{" "}
            There is no <Value>npm i @letternerd/sdk</Value> that works today. Depend on the checkout
            instead — a workspace dependency if your site lives in this monorepo, a{" "}
            <Value>file:</Value> dependency if it does not.
          </StepNote>
          <CodeBlock label="terminal" code={installSnippet()} />
        </Step>

        <Step number={3} id="client" title="The client">
          <StepNote>
            One module, imported everywhere else. <Value>baseUrl</Value> is this studio&rsquo;s API
            at <Value>{apiUrl(values)}</Value>; <Value>revalidate</Value> is the backstop for pages
            the webhook in step six has not purged.
          </StepNote>
          <CodeBlock label=".env.local" code={envSnippet(values)} />
          <CodeBlock label="lib/cms.ts" code={clientSnippet(values)} />
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-ink-muted)]">
            The key is a secret: it belongs in a server-side variable, never in a{" "}
            <Value>NEXT_PUBLIC_</Value> one. A <Value>cms_sk_</Value> key sent from a browser is
            refused with a 403 rather than quietly allowed, which is how a leak into client code
            gets found.
          </p>
        </Step>

        <Step number={4} id="post-page" title="The post page">
          <StepNote>
            Your blog lives at <Value>{site.blogBasePath}</Value>, so this file goes in{" "}
            <Value>{blogAppDir(site.blogBasePath)}/[slug]/</Value>. It renders on the server, which
            is the whole point: the article is in the HTML before any JavaScript runs.{" "}
            <Value>PostBody</Value> renders HTML already sanitised in the CMS at publish time — do
            not sanitise it again, or the article&rsquo;s own class names and heading ids are
            stripped and the page ships unstyled with dead anchors.
          </StepNote>
          <CodeBlock
            label={`${blogAppDir(site.blogBasePath)}/[slug]/page.tsx`}
            code={postPageSnippet(values)}
          />
        </Step>

        <Step number={5} id="routes" title="The four route files">
          <StepNote>
            One line each. They must be served from{" "}
            <strong className="font-semibold text-[var(--color-ink)]">your</strong> domain rather
            than from this studio: <Value>robots.txt</Value> is only ever read from the origin it
            governs, and a sitemap that lists URLs on a host which does not serve them is discarded.
            The CMS knows the content; the crawler trusts the domain.
          </StepNote>
          {routes.map((file) => (
            <CodeBlock key={file.path} label={file.path} caption={file.serves} code={file.code} />
          ))}

          <h3 className="mt-5 text-md font-semibold text-[var(--color-ink)]">
            The markdown alternate
          </h3>
          <StepNote>
            Every post&rsquo;s <Value>&lt;head&gt;</Value> already advertises a{" "}
            <Value>.md</Value> rendition of itself, so that URL has to resolve or the CMS has
            published a broken link. A Next segment is dynamic only when the whole folder name is
            bracketed, and a <Value>route.ts</Value> cannot sit beside <Value>page.tsx</Value> — so
            this one needs a handler plus a rewrite.
          </StepNote>
          <CodeBlock
            label={markdownRoute.path}
            caption={markdownRoute.serves}
            code={markdownRoute.code}
          />
          <CodeBlock
            label={markdownRewrite.path}
            caption={markdownRewrite.serves}
            code={markdownRewrite.code}
          />
        </Step>

        <Step number={6} id="webhook" title="The revalidation webhook">
          <StepNote>
            Three lines, and a public URL that purges caches — so it verifies an HMAC-SHA256 over
            the raw body against a signed timestamp before it does anything. An unsigned request is
            a 401 and purges nothing. Register{" "}
            <Value>{webhook.serves}</Value> under{" "}
            {canManageKeys ? (
              <Link
                href={`/${slug}/settings/webhooks`}
                className="ui-focus-ring rounded underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                Settings → Webhooks
              </Link>
            ) : (
              <>Settings → Webhooks, which an owner of this site can do</>
            )}
            ; the signing secret is shown once there, and that is what{" "}
            <Value>CMS_WEBHOOK_SECRET</Value> holds.
          </StepNote>
          <CodeBlock label={webhook.path} caption={webhook.serves} code={webhook.code} />
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-ink-muted)]">
            Honest caveat: outbound delivery is not shipped in this build of the CMS yet — the
            subscription is stored, nothing posts to it. Until it lands, published changes appear on
            your site within the <Value>revalidate</Value> window from step three. Wiring the route
            now costs three lines and means nothing has to change when delivery does.
          </p>
        </Step>

        <Step number={7} id="legacy" title="Already have a blog?">
          <StepNote>
            If <Value>{blogAppDir(site.blogBasePath)}/**</Value> already reads through a{" "}
            <Value>lib/posts.ts</Value> exposing <Value>getAllPosts</Value>,{" "}
            <Value>getPostBySlug</Value> and <Value>getAllSlugs</Value>, replace the body of that
            one file and change nothing else. Same field names, same types, same newest-first
            ordering, same <Value>null</Value> for a missing slug — your page components are
            untouched.
          </StepNote>
          <CodeBlock label="lib/posts.ts" code={legacySnippet(values)} />
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-ink-muted)]">
            <Value>getAllPosts</Value> fetches each body by default, so the objects it returns
            really are posts. On a large site pass <Value>{"{ hydrate: false }"}</Value> and read
            bodies on the detail page instead.
          </p>
        </Step>

        <VerifySection values={values} />
      </div>
    </div>
  );
}
