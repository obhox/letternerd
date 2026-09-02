import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { sites } from "./tenancy.js";

/**
 * A byline, deliberately not a login account.
 *
 * Two reasons this is its own table rather than a join to `user`. Guest
 * contributors need a byline without an account. And deleting a departed
 * employee's account must not vaporise the `Person` structured data on forty
 * published posts — hence the nullable `userId` with `onDelete: "set null"`.
 *
 * The `sameAs`, `jobTitle` and `knowsAbout` fields are not decoration: they
 * are what turns `author` in the JSON-LD from a bare string into a real
 * `Person` entity, which is the cheapest E-E-A-T lever available.
 */
export const authors = pgTable(
  "authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),

    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** → Person.jobTitle */
    jobTitle: text("job_title"),

    bioMd: text("bio_md"),
    bioHtml: text("bio_html"),
    avatarAssetId: uuid("avatar_asset_id"),

    email: text("email"),
    url: text("url"),
    /** → Person.sameAs. Profile URLs that corroborate the identity. */
    sameAs: text("same_as").array().notNull().default([]),
    /** → Person.knowsAbout. Topical authority, matched against entities. */
    knowsAbout: text("knows_about").array().notNull().default([]),
    /** Awards, affiliation, alumniOf — merged into the Person node. */
    credentials: jsonb("credentials").notNull().default({}),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("authors_site_slug_uq").on(t.siteId, t.slug),
    index("authors_user_idx").on(t.userId),
  ],
);
