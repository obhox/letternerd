import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres full-text search vector.
 *
 * Drizzle has no first-class tsvector, and the alternative — an external
 * search service — is not worth a second piece of infrastructure for a corpus
 * this size. A generated stored column keeps the index in step with the row
 * without a trigger to forget.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});
