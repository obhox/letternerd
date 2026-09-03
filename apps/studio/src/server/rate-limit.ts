/**
 * Request budgets for the surfaces better-auth does not cover.
 *
 * better-auth rate-limits `/api/auth/*` and nothing else. Every other entry
 * point — the content API, the MCP endpoint, media upload, cron, health — was
 * unmetered, which made three attacks cheap: exhausting the `max: 10` database
 * pool with garbage bearer tokens, pinning the CPU with concurrent 25 MB
 * uploads, and stuffing `crawler_hits` from a publishable key lifted out of a
 * customer's browser bundle. None needs a vulnerability; all need only a loop.
 *
 * Fixed windows in process memory, deliberately. A sliding log is more precise
 * and costs memory per request; a fixed window costs one counter per key and is
 * precise enough for budgets measured in requests per minute. The store is
 * bounded so an attacker rotating keys cannot grow it without limit — the
 * oldest entries are evicted first, which at worst forgets a bucket early.
 *
 * The caveat is the same one `@cms/auth` documents for its own limiter: this
 * does not survive a restart and is not shared between replicas, so the
 * effective budget multiplies by the replica count. The interface is a single
 * function so a Redis- or Postgres-backed store can replace it without touching
 * a call site.
 */

export interface RateLimitRule {
  /** Names the bucket family; appears in the `RateLimit-Policy` header. */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. Always ≥ 1 when refused. */
  retryAfterSeconds: number;
}

/**
 * The budgets, in one place so they can be read side by side.
 *
 * Reads are generous because a consuming site's ISR revalidation fans out to
 * every document it renders; writes are an order of magnitude tighter because
 * an agent making 120 changes a minute is either a bulk import — which has its
 * own capability — or a runaway. The analytics beacon is tightest of all: it is
 * the one write a publishable key can perform, and a publishable key is public.
 */
export const RULES = {
  v1Read: { name: "v1-read", limit: 600, windowMs: 60_000 },
  v1Write: { name: "v1-write", limit: 120, windowMs: 60_000 },
  analyticsWrite: { name: "analytics-write", limit: 60, windowMs: 60_000 },
  mcp: { name: "mcp", limit: 120, windowMs: 60_000 },
  upload: { name: "upload", limit: 20, windowMs: 60_000 },
  /** Requests that presented a key that did not verify, per source address. */
  badCredential: { name: "bad-credential", limit: 30, windowMs: 60_000 },
  cron: { name: "cron", limit: 30, windowMs: 60_000 },
  health: { name: "health", limit: 60, windowMs: 60_000 },
  /** Invitation redemption attempts, per source address: a token-guessing brake. */
  acceptInvite: { name: "accept-invite", limit: 10, windowMs: 300_000 },
  /** Site creation, per account: open signup makes this the next-cheapest loop to run. */
  createSite: { name: "create-site", limit: 5, windowMs: 3_600_000 },
} as const satisfies Record<string, RateLimitRule>;

interface Bucket {
  count: number;
  windowStart: number;
}

const MAX_BUCKETS = 50_000;

/** Insertion-ordered, so the first key is the least recently *created*. */
const buckets = new Map<string, Bucket>();

/**
 * Off only when explicitly asked, for end-to-end suites. Opt out by an explicit
 * flag and never by `NODE_ENV`, so a misconfigured production cannot silently
 * unlimit itself — the same rule `@cms/auth` applies to its own limiter.
 */
function disabled(): boolean {
  return process.env.CMS_RATE_LIMIT === "off";
}

export function rateLimit(rule: RateLimitRule, key: string, now: number = Date.now()): RateLimitDecision {
  if (disabled()) {
    return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0 };
  }

  const id = `${rule.name}:${key}`;
  let bucket = buckets.get(id);

  if (!bucket || now - bucket.windowStart >= rule.windowMs) {
    bucket = { count: 0, windowStart: now };
    // Re-inserting moves the key to the end, which keeps eviction roughly LRU
    // by window rather than strictly by first sight.
    buckets.delete(id);
    buckets.set(id, bucket);
    if (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  }

  bucket.count += 1;
  const resetIn = Math.max(1, Math.ceil((bucket.windowStart + rule.windowMs - now) / 1000));

  if (bucket.count > rule.limit) {
    return { allowed: false, limit: rule.limit, remaining: 0, retryAfterSeconds: resetIn };
  }
  return {
    allowed: true,
    limit: rule.limit,
    remaining: rule.limit - bucket.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Whether a key is already over budget, without spending any of it.
 *
 * For the failed-credential brake: the check runs before a lookup, and the
 * lookup that then fails is what spends a unit. Counting every presented key
 * would cap a well-behaved client at the failure budget.
 */
export function isRateLimited(rule: RateLimitRule, key: string, now: number = Date.now()): RateLimitDecision {
  if (disabled()) return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0 };
  const bucket = buckets.get(`${rule.name}:${key}`);
  if (!bucket || now - bucket.windowStart >= rule.windowMs) {
    return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0 };
  }
  const resetIn = Math.max(1, Math.ceil((bucket.windowStart + rule.windowMs - now) / 1000));
  if (bucket.count >= rule.limit) {
    return { allowed: false, limit: rule.limit, remaining: 0, retryAfterSeconds: resetIn };
  }
  return { allowed: true, limit: rule.limit, remaining: rule.limit - bucket.count, retryAfterSeconds: 0 };
}

/** For tests, and for nothing else. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * The response every refused caller gets.
 *
 * `Retry-After` is the header clients act on; the `RateLimit-*` trio is the
 * IETF draft that SDKs are starting to read. Both are set so neither kind of
 * client has to guess. The body names the budget rather than the caller's
 * count — how close they were is not information that helps a legitimate
 * client and does help someone probing the limits.
 */
export function rateLimitedResponse(
  decision: RateLimitDecision,
  rule: RateLimitRule,
  body: Record<string, unknown> = {},
): Response {
  return Response.json(
    {
      error: "rate_limited",
      message: `Too many requests. Retry after ${decision.retryAfterSeconds} seconds.`,
      ...body,
    },
    {
      status: 429,
      headers: rateLimitHeaders(decision, rule, { "Retry-After": String(decision.retryAfterSeconds) }),
    },
  );
}

export function rateLimitHeaders(
  decision: RateLimitDecision,
  rule: RateLimitRule,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.retryAfterSeconds || Math.ceil(rule.windowMs / 1000)),
    "RateLimit-Policy": `${rule.limit};w=${Math.ceil(rule.windowMs / 1000)}`,
    ...extra,
  };
}

/**
 * The address a request came from, as far as this process can tell.
 *
 * Read from one configurable header — `x-forwarded-for` by default, which
 * Traefik overwrites with the real peer; `cf-connecting-ip` behind Cloudflare,
 * where `x-forwarded-for` would make every visitor share Cloudflare's address.
 * The *first* entry is taken because that is the convention every proxy in
 * front follows when it appends; if the proxy in front does not overwrite the
 * header, this value is attacker-controlled and the operator must set the
 * header to one the proxy does control. `infra/DEPLOY.md` says so.
 *
 * An unknown address gets a shared bucket rather than a free pass: a request
 * with no usable source header is a request the proxy did not annotate, and
 * those should be rare enough that one bucket between them is harmless.
 */
export function clientIp(request: Request, header: string = "x-forwarded-for"): string {
  const raw = request.headers.get(header);
  if (!raw) return "unknown";
  const first = raw.split(",")[0]?.trim() ?? "";
  // Bounded so a header stuffed with kilobytes cannot become a kilobyte key.
  return first.length > 0 && first.length <= 64 ? first : "unknown";
}
