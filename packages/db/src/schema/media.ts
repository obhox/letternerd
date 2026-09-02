import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { sites } from "./tenancy.js";

export const mediaFolders = pgTable(
  "media_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    path: text("path").notNull().default("/"),
  },
  (t) => [index("media_folders_site_idx").on(t.siteId)],
);

/**
 * The original upload. Variants live in `mediaVariants`.
 *
 * Documents reference assets as `media://<id>`, never as a URL. That is what
 * makes a CDN domain migration a re-render rather than a find-and-replace
 * across every post, and it makes "is this asset still in use?" a text search
 * over `bodyMd` instead of a maintained reference count.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),

    /** Object-store key of the original. */
    key: text("key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Rendered as the placeholder background while the image decodes. */
    blurhash: text("blurhash"),
    dominantColor: text("dominant_color"),

    /** Required before an asset may be inserted. The publish gate re-checks. */
    alt: text("alt"),
    caption: text("caption"),
    credit: text("credit"),
    license: text("license"),

    folderId: uuid("folder_id").references(() => mediaFolders.id, {
      onDelete: "set null",
    }),
    /** Dedupes a re-upload of a file the site already has. */
    checksumSha256: text("checksum_sha256").notNull(),

    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("media_assets_site_checksum_uq").on(t.siteId, t.checksumSha256),
    index("media_assets_site_created_idx").on(t.siteId, t.createdAt.desc()),
    /** Powers the "N assets missing alt text" queue. */
    index("media_assets_missing_alt_idx")
      .on(t.siteId)
      .where(sql`alt is null or alt = ''`),
  ],
);

/**
 * One row per width × format. Keys are immutable — a given width and format
 * never changes meaning — so every variant ships `immutable` cache headers.
 */
export const mediaVariants = pgTable(
  "media_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** avif | webp | jpeg | png */
    format: text("format").notNull(),
    key: text("key").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("media_variants_asset_width_format_uq").on(t.assetId, t.width, t.format),
    index("media_variants_asset_idx").on(t.assetId),
  ],
);
