import { inArray } from "drizzle-orm";
import { renderDocument, type HeadingEntry, type RenderResult, type ResolvedMedia } from "@cms/content";
import * as schema from "@cms/db/schema";
import type { Database } from "@cms/db";
import { MEDIA_PROTOCOL } from "@cms/content";

/**
 * Render a document the way publishing will render it.
 *
 * The editor preview, the lint gate and the published HTML all come through
 * here, which is the property the whole content design rests on: a preview
 * that disagrees with production is the classic CMS failure mode, and the only
 * reliable way to prevent it is to have one code path rather than two that are
 * meant to match.
 */

const MEDIA_REF = new RegExp(`${MEDIA_PROTOCOL}([0-9a-fA-F-]{36})`, "g");

/**
 * Collect the media a document actually references, in one query.
 *
 * Scanning the markdown rather than maintaining a join table means a document
 * cannot drift out of sync with its own references — the text is the source of
 * truth for what it uses, and an editor who deletes an image line has, by
 * definition, stopped referencing it.
 */
export async function loadReferencedMedia(
  db: Database,
  siteId: string,
  markdown: string,
  cdnUrl: (key: string) => string,
): Promise<Map<string, ResolvedMedia>> {
  const ids = [...new Set([...markdown.matchAll(MEDIA_REF)].map((m) => m[1]!))];
  if (ids.length === 0) return new Map();

  const assets = await db.query.mediaAssets.findMany({
    where: (a, { and, eq }) => and(eq(a.siteId, siteId), inArray(a.id, ids)),
  });

  const variants = await db.query.mediaVariants.findMany({
    where: (v) => inArray(v.assetId, assets.map((a) => a.id)),
  });

  const byAsset = new Map<string, typeof variants>();
  for (const v of variants) {
    const list = byAsset.get(v.assetId) ?? [];
    list.push(v);
    byAsset.set(v.assetId, list);
  }

  return new Map(
    assets.map((a) => [
      a.id,
      {
        id: a.id,
        alt: a.alt,
        caption: a.caption,
        width: a.width,
        height: a.height,
        blurhash: a.blurhash,
        src: cdnUrl(a.key),
        variants: (byAsset.get(a.id) ?? [])
          .map((v) => ({ url: cdnUrl(v.key), width: v.width, format: v.format }))
          .sort((x, y) => x.width - y.width),
      } satisfies ResolvedMedia,
    ]),
  );
}

export interface RenderContextRow {
  slug: string;
  bodyMd: string;
  headings: unknown;
  siteId: string;
}

export async function renderForSite(args: {
  db: Database;
  site: { id: string; baseUrl: string; blogBasePath: string; locale: string };
  doc: RenderContextRow;
  cdnUrl: (key: string) => string;
  publicFrontmatter?: Record<string, unknown>;
}): Promise<RenderResult> {
  const media = await loadReferencedMedia(args.db, args.site.id, args.doc.bodyMd, args.cdnUrl);

  return renderDocument({
    markdown: args.doc.bodyMd,
    slug: args.doc.slug,
    site: {
      baseUrl: args.site.baseUrl,
      blogBasePath: args.site.blogBasePath,
      locale: args.site.locale,
    },
    // Previously published anchors, so a citation made months ago still
    // resolves after an edit renames the heading around it.
    existingHeadings: (args.doc.headings as HeadingEntry[] | null) ?? undefined,
    resolveMedia: (id) => media.get(id),
    publicFrontmatter: args.publicFrontmatter,
  });
}
