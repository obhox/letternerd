/**
 * The vocabulary every provider and every insight rule speaks.
 *
 * These shapes are deliberately small. Falorb, Search Console and the CMS's
 * own crawler log each have a rich, incompatible native format; converting to
 * a shared shape at the edge is what lets `mergeProviders` and the insight
 * rules stay ignorant of where a number came from.
 */

/** ISO `yyyy-mm-dd`, inclusive at both ends — the convention every provider here uses. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * What one path did over a range, as far as the providers can tell.
 *
 * **Every metric is optional, and a provider that cannot supply one must
 * return `undefined` — never `0`.** Zero and "not measured" mean opposite
 * things to an editor deciding whether to rewrite a post. Zero clicks on 4,000
 * impressions is a broken title and an afternoon's work; *unknown* clicks
 * because Search Console is not connected for this site is a configuration
 * task and no evidence at all about the post. Collapsing the two produces a
 * dashboard that confidently recommends rewriting healthy content, and an
 * editor who learns to ignore the dashboard.
 *
 * The same rule runs through the insight rules below: a rule skips a document
 * whose deciding metric is `undefined` rather than treating it as zero.
 */
export interface PagePerformance {
  path: string;
  /** Audience — from Falorb. */
  views?: number;
  visitors?: number;
  /** Search — from Google Search Console. */
  impressions?: number;
  clicks?: number;
  /** Fraction in 0..1, as GSC reports it. Not a percentage. */
  ctr?: number;
  /** Average SERP position. Fractional and never rounded; see `search-console.ts`. */
  position?: number;
}

/**
 * One query's numbers. Unlike `PagePerformance` these are all required: a
 * query row only exists because a search provider produced it, and a search
 * provider that has the row has all four metrics.
 */
export interface QueryPerformance {
  query: string;
  path?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

/** One point of a daily series. `date` is ISO `yyyy-mm-dd`. */
export interface TimeseriesPoint {
  date: string;
  value: number;
}
