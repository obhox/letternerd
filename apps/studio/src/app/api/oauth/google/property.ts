/**
 * Choosing which Search Console property a site's numbers come from.
 *
 * Google's consent screen grants access to an *account*, not to a property. An
 * agency's Google account may hold forty properties, and this flow has to
 * decide which one belongs to the site being connected.
 *
 * Getting it wrong is not a cosmetic error and it does not announce itself. The
 * insights screen fills with somebody else's impressions, rankings and decay
 * findings, and an editor works through them — rewriting titles on pages that
 * were ranking fine — with nothing anywhere saying the numbers are from another
 * site. That is why there is deliberately **no** "if in doubt take the first
 * one" fallback: an arbitrary choice among several is exactly that failure,
 * made silently. When nothing matches, the caller reports it and the person
 * picks up the problem in Search Console, where it belongs.
 *
 * Kept free of imports so it can be tested without the studio's environment.
 */

export interface SearchConsoleSiteEntry {
  siteUrl?: unknown;
  permissionLevel?: unknown;
}

function withSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function pickProperty(
  entries: readonly SearchConsoleSiteEntry[],
  baseUrl: string,
): string | null {
  const usable = entries.filter(
    (entry): entry is { siteUrl: string; permissionLevel?: unknown } =>
      typeof entry.siteUrl === "string" &&
      entry.siteUrl.length > 0 &&
      /**
       * `siteUnverifiedUser` means the account can see the property in a list
       * and cannot query it. Connecting one produces a credential that fails
       * every read with a 403 — which surfaces as "reconnect Search Console",
       * a message that will never help, because reconnecting is not the fix.
       */
      entry.permissionLevel !== "siteUnverifiedUser",
  );

  if (usable.length === 0) return null;

  const host = hostOf(baseUrl);
  if (host === null) return null;
  const bareHost = host.replace(/^www\./, "");

  // 1. An exact URL-prefix property for this origin.
  const target = withSlash(new URL(baseUrl).toString()).toLowerCase();
  const exact = usable.find((entry) => withSlash(entry.siteUrl).toLowerCase() === target);
  if (exact) return exact.siteUrl;

  /**
   * 2. A domain property covering the host.
   *
   * Preferred over a same-host URL-prefix variant because a domain property
   * covers every scheme and subdomain, so it is the one that keeps working
   * when the site moves to https or drops its `www.`.
   */
  const domain = usable.find(
    (entry) =>
      entry.siteUrl.toLowerCase() === `sc-domain:${host}` ||
      entry.siteUrl.toLowerCase() === `sc-domain:${bareHost}`,
  );
  if (domain) return domain.siteUrl;

  // 3. A URL-prefix property on the same host, differing only by scheme or a
  //    `www.` prefix — the common state of a site that migrated to https.
  const sameHost = usable.filter((entry) => {
    const entryHost = hostOf(entry.siteUrl);
    return entryHost !== null && entryHost.replace(/^www\./, "") === bareHost;
  });
  /**
   * Only when it is unambiguous. Two same-host candidates (`http://` and
   * `https://`, say) hold genuinely different data, and picking one by list
   * order would be the silent wrong-site choice in miniature.
   */
  if (sameHost.length === 1) return sameHost[0]?.siteUrl ?? null;

  return null;
}
