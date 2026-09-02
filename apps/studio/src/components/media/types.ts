/**
 * What the media screen hands its client components.
 *
 * Deliberately not the capability's row type. The server component resolves
 * every CDN URL and builds every `srcset` before this crosses the boundary, so
 * the client never needs the storage driver, never sees an object key it could
 * be tempted to concatenate a URL from, and receives nothing that is not JSON.
 */
export interface MediaCardAsset {
  id: string;
  /** `media://<id>` — what an author pastes into markdown. */
  ref: string;
  filename: string;
  alt: string;
  caption: string;
  credit: string;
  mimeType: string;
  bytes: number;
  /** Intrinsic pixel size of the original, used as the `<img>` width/height. */
  width: number | null;
  height: number | null;
  /** Painted behind the image while it decodes, so the grid is never blank. */
  placeholderColor: string | null;
  hasBlurhash: boolean;
  srcsetAvif: string;
  srcsetWebp: string;
  fallbackSrc: string;
  uploadedAt: string;
}

/** One document that still points at an asset someone tried to delete. */
export interface ReferencingDocument {
  id: string;
  title: string;
  slug: string;
  status: string;
}
