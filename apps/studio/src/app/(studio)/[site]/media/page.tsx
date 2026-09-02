import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { can } from "@cms/core/roles";
import { cdnUrlFactory, type MediaAssetView } from "@cms/capabilities";
import { buildSrcset } from "@cms/media";
import { Badge, Button, PageHeader, cn } from "@cms/ui";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { storage } from "@/server/services";
import { MediaGrid } from "@/components/media/media-grid";
import { UploadDropzone } from "@/components/media/upload-dropzone";
import type { MediaCardAsset } from "@/components/media/types";

export const metadata: Metadata = { title: "Media" };

/**
 * The capability's own return shape, imported rather than restated.
 *
 * A local copy of these fields would typecheck happily for exactly as long as
 * it took someone to add a column to `list_media`.
 */
interface ListMediaResult {
  assets: MediaAssetView[];
  missingAltCount: number;
  nextCursor: string | null;
}

const PAGE_SIZE = 48;

/**
 * The media library.
 *
 * Everything on this screen is arranged around one number: how many assets have
 * no alt text. That is not a stylistic preference — a missing alt is a hard
 * publish gate, so it is the only media problem that can stop an author's work,
 * and a library that hides it behind a detail view converts a five-second fix
 * into a support question at publish time. Hence the count in the header, the
 * filter that isolates the queue, and an editable alt field on the face of
 * every card.
 */
export default async function MediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<{ missing?: string; cursor?: string }>;
}) {
  const { site: slug } = await params;
  const query = await searchParams;
  const ctx = await studioContext(slug);

  const missingOnly = query.missing === "1";
  const result = await dispatchOrThrow<ListMediaResult>(ctx, "list_media", {
    missingAltOnly: missingOnly,
    limit: PAGE_SIZE,
    ...(query.cursor ? { cursor: query.cursor } : {}),
  });

  /**
   * Keys become URLs here and nowhere further down.
   *
   * The client components receive finished `srcset` strings, so nothing in the
   * browser bundle knows how a CDN URL is assembled — which is what keeps
   * changing CDN a server-side concern.
   */
  const cdnUrl = cdnUrlFactory(storage);

  const assets: MediaCardAsset[] = result.assets.map((asset) => {
    // The raster fallback is the one variant a browser without AVIF or WebP
    // can use; the stored original is the last resort behind it.
    const fallback =
      asset.variants.find((v) => v.format === "jpeg" || v.format === "png") ?? null;

    return {
      id: asset.id,
      ref: asset.ref,
      filename: asset.originalFilename ?? "Untitled",
      alt: asset.alt ?? "",
      caption: asset.caption ?? "",
      credit: asset.credit ?? "",
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      placeholderColor: asset.dominantColor,
      hasBlurhash: asset.blurhash !== null,
      srcsetAvif: buildSrcset(asset.variants, "avif", cdnUrl),
      srcsetWebp: buildSrcset(asset.variants, "webp", cdnUrl),
      fallbackSrc: cdnUrl(fallback?.key ?? asset.key),
      uploadedAt: asset.createdAt.toISOString(),
    };
  });

  const basePath = `/${slug}/media`;
  const missingCount = result.missingAltCount;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Media"
        description="Images available to every document on this site. Paste an image into markdown with its media:// reference."
      >
        {/*
          The count is rendered whether or not the filter is on, and it is the
          filter's own control. An editor should never have to go looking for
          how much alt-text debt is outstanding.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant={missingOnly ? "ghost" : "secondary"} size="sm">
            <Link href={basePath}>All images</Link>
          </Button>

          <Button
            asChild
            variant={missingOnly ? "default" : "ghost"}
            size="sm"
            className={cn(missingCount === 0 && "pointer-events-none opacity-50")}
          >
            <Link href={`${basePath}?missing=1`} aria-disabled={missingCount === 0}>
              <AlertTriangleIcon aria-hidden="true" />
              Missing alt text
              <Badge variant={missingCount > 0 ? "warning" : "success"} className="ml-1">
                {missingCount}
              </Badge>
            </Link>
          </Button>

          {missingCount > 0 && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {missingCount === 1 ? "One image" : `${missingCount} images`} will refuse a publish in
              any document that uses {missingCount === 1 ? "it" : "them"}.
            </p>
          )}
        </div>
      </PageHeader>

      <UploadDropzone siteSlug={slug}>
        <MediaGrid
          siteSlug={slug}
          assets={assets}
          canDelete={can.deleteMedia(ctx.role)}
          filtered={missingOnly}
        />

        {result.nextCursor && (
          <nav className="mt-4 flex justify-center" aria-label="Pagination">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`${basePath}?${new URLSearchParams({
                  ...(missingOnly ? { missing: "1" } : {}),
                  cursor: result.nextCursor,
                }).toString()}`}
              >
                Next page
              </Link>
            </Button>
          </nav>
        )}
      </UploadDropzone>
    </div>
  );
}
