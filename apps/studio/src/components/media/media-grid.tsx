"use client";

import { ImageIcon } from "lucide-react";
import { EmptyState } from "@cms/ui";
import { AssetCard } from "./asset-card";
import type { MediaCardAsset } from "./types";

/**
 * The grid itself.
 *
 * `auto-fill` with a minimum rather than a fixed column count, so the same
 * markup is a single column on a phone and six on a wide display without a
 * breakpoint ladder to maintain.
 */
export function MediaGrid({
  siteSlug,
  assets,
  canDelete,
  filtered,
}: {
  siteSlug: string;
  assets: MediaCardAsset[];
  canDelete: boolean;
  filtered: boolean;
}) {
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        title={filtered ? "Every image has alt text" : "No images yet"}
        description={
          filtered ? undefined : "Drag images anywhere on this page, or use the upload button."
        }
      />
    );
  }

  return (
    <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
      {assets.map((asset) => (
        <li key={asset.id}>
          <AssetCard siteSlug={siteSlug} asset={asset} canDelete={canDelete} />
        </li>
      ))}
    </ul>
  );
}
