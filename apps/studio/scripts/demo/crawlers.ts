import { createHash } from "node:crypto";

/**
 * Synthetic crawler traffic.
 *
 * The Insights screen is the one screen that cannot be made to look real by
 * writing good content: it reads a log, and an empty log renders as an honest
 * but unsellable "nothing has fetched anything". So the log gets populated —
 * but populated in a shape the screen's own arithmetic will survive, which
 * takes more care than scattering rows at random.
 *
 * Three properties the generator has to preserve.
 *
 * **Posts must differ from each other.** A flat distribution makes the
 * per-document table meaningless, so each post carries an appetite weight and
 * two carry zero — the never-fetched case is a real finding and deserves to be
 * visible.
 *
 * **Time-to-first-crawl has to be computable.** `timeToFirstCrawl` measures
 * from `firstPublishedAt` to the earliest retained AI-category hit, and it
 * refuses to answer when the log does not cover the document's whole life.
 * Filling only the last 30 days would therefore render every post published
 * before that as "unknown" — technically correct and completely uninformative.
 * So each fetched post also gets one early AI hit shortly after it went live,
 * which is both what really happens and what makes the median meaningful.
 *
 * **"Never" must be truthful.** Because those early rows push the log's
 * earliest timestamp back before the oldest publish date, the screen is
 * entitled to say "never crawled" about the two posts nothing fetched, instead
 * of hedging to "unknown".
 */

/** Deterministic, so two runs of the seed produce the same charts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bot {
  name: string;
  /** `ai` is the category `timeToFirstCrawl` measures against. */
  category: "ai" | "search";
  userAgent: string;
  /** Share of total volume. Roughly what a mid-sized B2B blog sees. */
  share: number;
}

const BOTS: Bot[] = [
  {
    name: "GPTBot",
    category: "ai",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
    share: 0.26,
  },
  {
    name: "ClaudeBot",
    category: "ai",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com",
    share: 0.22,
  },
  {
    name: "Googlebot",
    category: "search",
    userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    share: 0.24,
  },
  {
    name: "PerplexityBot",
    category: "ai",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
    share: 0.16,
  },
  {
    name: "bingbot",
    category: "search",
    userAgent: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    share: 0.12,
  },
];

/**
 * How much attention each post gets, keyed by slug.
 *
 * Hand-set rather than derived, because the interesting shape is the one a
 * real blog has: two or three posts carry most of the traffic, the long tail
 * is thin, and something nobody has ever linked to sits at zero. Anything not
 * listed falls back to a modest default.
 */
const APPETITE: Record<string, number> = {
  "expense-policy-that-people-actually-follow": 10,
  "month-end-close-checklist": 8,
  "corporate-cards-vs-reimbursements": 7,
  "what-soc-2-type-ii-means-for-your-finance-stack": 6,
  "accruals-without-the-spreadsheet": 5,
  "approval-rules-that-dont-become-bottlenecks": 4,
  "how-receipt-matching-works": 3,
  "modelling-multi-currency-spend": 2,
  "northwind-logistics-four-day-close": 2,
  // Published last month and last quarter, and nothing has come for either.
  // The never-crawled finding is the point of leaving these at zero.
  "budget-owners-not-budget-police": 0,
  "forecasting-spend-from-commitments": 0,
  // Archived, and crawled once long ago rather than in the recent window.
  "2025-spend-benchmarks": 1,
};

const DEFAULT_APPETITE = 2;

export function appetiteFor(slug: string): number {
  return APPETITE[slug] ?? DEFAULT_APPETITE;
}

export interface CrawlTarget {
  documentId: string;
  slug: string;
  path: string;
  firstPublishedAt: Date | null;
}

export interface CrawlerHitRow {
  documentId: string | null;
  botName: string;
  botCategory: string;
  userAgent: string;
  path: string;
  statusCode: number;
  referer: string | null;
  ipHash: string;
  occurredAt: Date;
}

/**
 * Paths a crawler fetches that are not documents.
 *
 * Worth including because they are most of what an AI crawler actually asks
 * for, and because a per-document table that accounts for 100% of the log is a
 * tell that the log was invented.
 */
const INFRASTRUCTURE_PATHS = ["/sitemap.xml", "/robots.txt", "/llms.txt", "/blog", "/blog/feed.xml"];

/** The old URL of the renamed post, still being fetched and still redirecting. */
const REDIRECTED_PATH = "/blog/corporate-cards-vs-reimbursement";

/**
 * IPs are only ever stored as a salted daily hash, and the demo respects that
 * even though no real address is involved — a seed that writes a plausible
 * dotted quad into `ip_hash` teaches the next reader the wrong thing about
 * what the column holds.
 */
function ipHash(botName: string, day: string, index: number): string {
  return createHash("sha256").update(`demo-salt:${day}:${botName}:${index % 6}`).digest("hex");
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function pickBot(random: () => number): Bot {
  let roll = random();
  for (const bot of BOTS) {
    roll -= bot.share;
    if (roll <= 0) return bot;
  }
  return BOTS[0]!;
}

export interface TrafficOptions {
  targets: readonly CrawlTarget[];
  now: Date;
  /** Width of the dense recent window, in days. */
  days: number;
  /** Approximate number of rows inside that window. */
  hits: number;
  seed?: number;
}

export function buildCrawlerTraffic(options: TrafficOptions): CrawlerHitRow[] {
  const random = mulberry32(options.seed ?? 0x5eed1e);
  const rows: CrawlerHitRow[] = [];

  const aiBots = BOTS.filter((bot) => bot.category === "ai");
  const fetched = options.targets.filter((target) => appetiteFor(target.slug) > 0);

  /**
   * The first fetch after publication, one per crawled document.
   *
   * Between two hours and three days, skewed short, which is what a site with
   * a correct sitemap `lastmod` and on-demand revalidation actually sees. This
   * is the only reason the median on the Insights screen is a number rather
   * than a dash.
   */
  for (const [index, target] of fetched.entries()) {
    if (!target.firstPublishedAt) continue;
    const bot = aiBots[index % aiBots.length]!;
    const delayHours = 2 + Math.round(random() ** 2 * 70);
    const occurredAt = new Date(target.firstPublishedAt.getTime() + delayHours * 3_600_000);
    // A first crawl dated in the future is not a first crawl; skip anything
    // whose publish date is too recent for the delay to have elapsed.
    if (occurredAt.getTime() > options.now.getTime()) continue;
    rows.push({
      documentId: target.documentId,
      botName: bot.name,
      botCategory: bot.category,
      userAgent: bot.userAgent,
      path: target.path,
      statusCode: 200,
      referer: null,
      ipHash: ipHash(bot.name, isoDay(occurredAt), index),
      occurredAt,
    });
  }

  /** Weighted draw over documents plus the non-document paths. */
  const pool: { documentId: string | null; path: string; weight: number; status: number }[] = [
    ...fetched.map((target) => ({
      documentId: target.documentId,
      path: target.path,
      weight: appetiteFor(target.slug),
      status: 200,
    })),
    ...INFRASTRUCTURE_PATHS.map((path) => ({
      documentId: null,
      path,
      weight: path === "/sitemap.xml" ? 6 : 3,
      status: 200,
    })),
    // Still arriving at the pre-rename URL, and still being redirected. It is
    // the evidence that slug history is doing something.
    { documentId: null, path: REDIRECTED_PATH, weight: 1, status: 301 },
  ];

  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const windowMs = options.days * 86_400_000;
  const start = options.now.getTime() - windowMs;

  for (let i = 0; i < options.hits; i++) {
    const bot = pickBot(random);

    /**
     * Volume ramps across the window rather than sitting flat.
     *
     * Crawl rate rises as a site publishes, and a perfectly level series is
     * the single most obvious sign of generated data — it is the one thing no
     * real log ever looks like.
     */
    const position = Math.min(0.999, (random() * 0.55 + random() * 0.45) ** 0.8);
    const occurredAt = new Date(start + position * windowMs);

    let roll = random() * totalWeight;
    let choice = pool[pool.length - 1]!;
    for (const entry of pool) {
      roll -= entry.weight;
      if (roll <= 0) {
        choice = entry;
        break;
      }
    }

    // A crawler that has seen a page before mostly gets a 304 back. Including
    // them keeps the status distribution honest and stops every row looking
    // like a first visit.
    const status = choice.status === 200 && random() < 0.18 ? 304 : choice.status;

    rows.push({
      documentId: choice.documentId,
      botName: bot.name,
      botCategory: bot.category,
      userAgent: bot.userAgent,
      path: choice.path,
      statusCode: status,
      referer: null,
      ipHash: ipHash(bot.name, isoDay(occurredAt), i),
      occurredAt,
    });
  }

  return rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

export interface DailyRollupRow {
  day: string;
  botName: string;
  hits: number;
  uniquePaths: number;
}

/**
 * The per-day rollup the crawler chart is actually drawn from.
 *
 * In production a nightly job builds this and prunes the raw rows behind it,
 * so the two tables are never derived from each other at read time. The seed
 * has to write both for the same reason: filling only the raw table leaves the
 * chart empty, and filling only the rollup leaves the per-document table empty.
 */
export function rollUpDaily(rows: readonly CrawlerHitRow[]): DailyRollupRow[] {
  const buckets = new Map<string, { day: string; botName: string; hits: number; paths: Set<string> }>();

  for (const row of rows) {
    const day = isoDay(row.occurredAt);
    const key = `${day}|${row.botName}`;
    const bucket = buckets.get(key) ?? { day, botName: row.botName, hits: 0, paths: new Set() };
    bucket.hits += 1;
    bucket.paths.add(row.path);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      day: bucket.day,
      botName: bucket.botName,
      hits: bucket.hits,
      uniquePaths: bucket.paths.size,
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.botName.localeCompare(b.botName));
}
