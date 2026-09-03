/**
 * Where an API key may be sent.
 *
 * Both the client and the CLI put `Authorization: Bearer cms_sk_…` on every
 * request, and neither has any other way of knowing whether the URL it was
 * handed is the studio or something on the path to it. Over plain HTTP that
 * header is readable by every hop, so a mistyped scheme in `CMS_API_URL` or
 * `--studio-url` would leak a read key to the coffee-shop network without a
 * single error. The rule is therefore `https:` — with one exception for the
 * loopback names, because a studio running on `localhost:3000` during
 * development has no certificate and no network for the key to cross.
 *
 * This lives in one place and is called from both transports so that the two
 * cannot disagree about what "local" means. It uses nothing but the global
 * `URL`, so the core entry stays runtime-agnostic.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/**
 * Throws a `TypeError` unless `url` is `https:`, or `http:` to a loopback host.
 *
 * @param label names the option the URL came from, so the error says what to fix.
 */
export function assertSecureOrigin(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${label}: ${JSON.stringify(url)} is not a valid URL.`);
  }

  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) return;

  const scheme = parsed.protocol.replace(/:$/, "");
  throw new TypeError(
    `${label}: refusing to send the API key over ${scheme} to ${parsed.host}. ` +
      "Use an https:// URL; plain http:// is only allowed for localhost.",
  );
}
