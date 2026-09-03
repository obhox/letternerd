import { buildInstallPlan } from "./snippets";
import type { InstallPlan, InstallValues, PackageManager } from "./snippets";

export type { InstallPlan, InstallValues, PackageManager, PlanFile } from "./snippets";

/**
 * Where a plan comes from.
 *
 * Two sources, and they are not equal. A studio knows the site's real origin,
 * its blog base path, its locale and a slug that is actually published; the
 * fallback knows none of those and says so. The CLI prefers the live one
 * whenever it is given the means to fetch it, and labels the result either way
 * — an agent that cannot tell which plan it applied cannot tell whether the
 * canonical URLs in the verification commands mean anything.
 */
export type PlanSource = "studio" | "fallback";

export interface ResolvedPlan {
  plan: InstallPlan;
  source: PlanSource;
}

export interface PlanInputs {
  /** e.g. `https://studio.example.com`. */
  studioOrigin: string | null;
  /** e.g. `https://studio.example.com/api/v1`. */
  apiUrl: string | null;
  /** The consuming site's own origin, for the verification commands. */
  siteUrl: string | null;
  blogPath: string;
  packageManager: PackageManager;
}

const STUDIO_PLACEHOLDER = "https://studio.example.com";
const SITE_PLACEHOLDER = "https://your-site.example.com";

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** `https://studio.example.com/api/v1` ⇄ `https://studio.example.com`. */
export function studioOriginFromApiUrl(apiUrl: string): string {
  return trimSlash(trimSlash(apiUrl).replace(/\/api\/v1$/, ""));
}

/**
 * The plan to use when there is no studio to ask.
 *
 * Every file it emits is correct — it is the same generator the CMS runs. What
 * it cannot know is the substitutions, so the placeholders it leaves are loud
 * ones and the notes say which values are guesses. A fallback that quietly
 * wrote `https://example.com` into a canonical check would be worse than one
 * that refuses, because the check would pass against nothing.
 */
export function fallbackPlan(inputs: PlanInputs): ResolvedPlan {
  const studioOrigin =
    inputs.studioOrigin ??
    (inputs.apiUrl ? studioOriginFromApiUrl(inputs.apiUrl) : null) ??
    STUDIO_PLACEHOLDER;

  const values: InstallValues = {
    siteName: "Your site",
    studioOrigin,
    baseUrl: inputs.siteUrl ?? SITE_PLACEHOLDER,
    blogBasePath: inputs.blogPath,
    locale: "en",
    sampleSlug: null,
  };

  const plan = buildInstallPlan(values, { packageManager: inputs.packageManager });

  plan.notes.unshift(
    "This is the SDK's built-in plan, not this site's. The file contents are the same generator " +
      "the CMS runs, but the substituted values are defaults: run again with --studio-url and a " +
      "read key to get the site's real origin, blog path, locale and a published slug.",
  );
  if (studioOrigin === STUDIO_PLACEHOLDER) {
    plan.notes.push(
      `CMS_API_URL is a placeholder (${STUDIO_PLACEHOLDER}/api/v1). Replace it with the studio's ` +
        `real origin, or pass --base-url / set CMS_API_URL.`,
    );
  }
  if (inputs.siteUrl === null) {
    plan.notes.push(
      `The site's own origin is a placeholder (${SITE_PLACEHOLDER}), so the verification commands ` +
        `address a domain that does not exist. Pass --site-url to make them runnable.`,
    );
  }

  return { plan, source: "fallback" };
}

export interface FetchPlanOptions {
  studioOrigin: string;
  key: string;
  blogPath?: string | undefined;
  packageManager: PackageManager;
  fetchImpl?: typeof fetch;
}

/**
 * The real plan, from the studio that owns the content.
 *
 * A failure here is not silently downgraded to the fallback. An agent that
 * asked for this site's plan and got a generic one would write nine files with
 * a placeholder API URL in them and have no reason to look — so this throws,
 * and the caller says what to do about it.
 */
export async function fetchPlan(options: FetchPlanOptions): Promise<ResolvedPlan> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = new URL(`${trimSlash(options.studioOrigin)}/api/v1/site/install-plan`);
  url.searchParams.set("framework", "next-app-router");
  url.searchParams.set("packageManager", options.packageManager);
  if (options.blogPath) url.searchParams.set("blogBasePath", options.blogPath);

  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      headers: { Authorization: `Bearer ${options.key}`, Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(`Could not reach ${url.origin}: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${url.origin} answered ${response.status} for the install plan${detail ? `: ${detail.slice(0, 400)}` : "."}` +
        (response.status === 401
          ? "\n  401 covers malformed, unknown, revoked and expired keys with one identical answer. Check the key."
          : response.status === 404
            ? "\n  404 means this studio does not expose get_install_plan — it may be an older build."
            : ""),
    );
  }

  const plan = (await response.json()) as InstallPlan;
  if (!Array.isArray(plan.files) || plan.files.length === 0) {
    throw new Error(`${url.origin} returned no files in its install plan.`);
  }
  return { plan, source: "studio" };
}
