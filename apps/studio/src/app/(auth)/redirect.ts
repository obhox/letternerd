/**
 * Validation for the `?redirect=` parameter the sign-in and sign-up pages honour.
 *
 * A login page that forwards to an attacker-supplied URL is the most valuable
 * open redirect there is. The victim follows a link, sees the real studio at
 * the real domain, types real credentials into a real form — and is then handed
 * to a page of the attacker's choosing, arriving with every appearance of
 * having just been authenticated. Nothing about the flow looks wrong, because
 * up to the last hop nothing was.
 *
 * So the rule is not "reject the dangerous ones". It is: accept only a
 * same-origin path, and treat everything else as if the parameter were absent.
 * An allowlist has no interesting failure mode — a legitimate destination that
 * is wrongly rejected sends the user to the studio home, which is a shrug.
 */

/** Where a visitor goes when there is nowhere better to send them. */
export const DEFAULT_DESTINATION = "/";

export function safeRedirect(candidate: string | string[] | undefined | null): string {
  /**
   * A repeated query parameter arrives as an array. Taking the first value
   * would let an attacker append their own `?redirect=` to a legitimate link
   * and hope the reader checks only the one they can see; there is no
   * legitimate reason for two, so two is a refusal.
   */
  if (typeof candidate !== "string") return DEFAULT_DESTINATION;

  const target = candidate.trim();
  if (target === "") return DEFAULT_DESTINATION;

  /**
   * Must be a path. `https://evil.example` and `javascript:…` are excluded
   * here, and so is `evil.example/path`, which some routers will happily treat
   * as a host.
   */
  if (!target.startsWith("/")) return DEFAULT_DESTINATION;

  /**
   * `//evil.example` is a protocol-relative URL: a full cross-origin
   * destination that begins with a slash and passes any check that only looks
   * at the first character. `/\evil.example` is the same attack against
   * browsers that normalise a backslash to a slash, which they do.
   */
  if (target.startsWith("//") || target.startsWith("/\\")) return DEFAULT_DESTINATION;

  /**
   * Control characters — a stray newline, tab or NUL — exist in these values
   * only to smuggle something past a parser. Browsers strip some of them
   * before resolving the URL, which means the string that is validated and the
   * string that is navigated to are not the same string.
   */
  if (/[\u0000-\u001f\u007f]/.test(target)) return DEFAULT_DESTINATION;

  /**
   * Final check against a URL parser rather than against more string rules.
   * Resolving the candidate relative to an origin and confirming it did not
   * escape catches whatever the prefix tests above did not anticipate — the
   * parser, not this function, is the authority on what the browser will do
   * with the string. The base origin is arbitrary and never used; only the
   * question "did resolution leave it?" matters.
   */
  try {
    const base = "https://studio.invalid";
    const resolved = new URL(target, base);
    if (resolved.origin !== base) return DEFAULT_DESTINATION;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_DESTINATION;
  }
}
