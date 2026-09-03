import { isIP } from "node:net";

/**
 * Where the CMS may be told to send a request.
 *
 * A webhook URL is an instruction to make an HTTP request from inside the
 * studio's network, signed with a secret the studio holds. Left unchecked it
 * is a server-side request forgery primitive: `https://169.254.169.254/` reads
 * the cloud metadata service, `https://10.0.0.5:5432/` probes the database
 * host, `https://localhost:3000/api/cron/…` calls this process back with a
 * body it signed itself. None of these are destinations a customer's site
 * lives at, so refusing them costs nothing.
 *
 * Two layers, because each catches what the other cannot. The syntactic check
 * runs on the URL as written and needs no network: literal private addresses,
 * loopback names, `.internal`/`.local` suffixes. The resolved check runs the
 * hostname through DNS and refuses when *any* answer is a private address —
 * `evil.example` can be an A record for `10.0.0.5`, and the URL looks fine.
 * DNS rebinding — a public answer now, a private one at delivery — is why the
 * deliverer must repeat the resolved check at send time; this module only
 * hands it the function.
 */

export interface NetService {
  /** Every address a hostname resolves to. Empty when it does not resolve. */
  resolve(hostname: string): Promise<string[]>;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata", "metadata.google.internal"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".in-addr.arpa", ".ip6.arpa"];

/**
 * Whether an address is one the public internet cannot reach.
 *
 * Covers loopback, RFC 1918, carrier-grade NAT, link-local (which is where
 * cloud metadata lives), the unspecified address, and their IPv6 equivalents
 * — including IPv4 addresses mapped into IPv6, which is the classic way past a
 * check that only looks at dotted quads.
 */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPrivateV4(address);
  if (kind === 6) return isPrivateV6(address);
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier-grade NAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateV6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms carry an IPv4 payload.
  const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lower) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPrivateV4(mapped[1]);
  // ::ffff:7f00:1 — the same mapping written in hex.
  const hexMapped = /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(lower);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("64:ff9b:")) return true; // NAT64, carries IPv4
  if (lower.startsWith("2001:db8:")) return true; // documentation
  return false;
}

export type UrlProblem =
  | "not_https"
  | "credentials_in_url"
  | "literal_private_address"
  | "blocked_hostname"
  | "unresolvable"
  | "resolves_to_private_address"
  | "malformed";

/**
 * The syntactic half. No network, no promise; safe to run on every save.
 */
export function publicHttpsUrlProblem(raw: string): UrlProblem | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "malformed";
  }
  if (url.protocol !== "https:") return "not_https";
  if (url.username || url.password) return "credentials_in_url";

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) {
    return isPrivateAddress(host) ? "literal_private_address" : null;
  }
  if (BLOCKED_HOSTNAMES.has(host)) return "blocked_hostname";
  if (!host.includes(".")) return "blocked_hostname"; // bare service names on a Docker network
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return "blocked_hostname";
  return null;
}

/**
 * Both halves. Resolves the hostname when a resolver is supplied and refuses
 * if any answer is private. A hostname that does not resolve is refused too:
 * a webhook nobody can deliver to is a misconfiguration worth reporting now.
 */
export async function publicUrlProblem(raw: string, net?: NetService): Promise<UrlProblem | null> {
  const syntactic = publicHttpsUrlProblem(raw);
  if (syntactic) return syntactic;
  if (!net) return null;

  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;

  let addresses: string[];
  try {
    addresses = await net.resolve(host);
  } catch {
    return "unresolvable";
  }
  if (addresses.length === 0) return "unresolvable";
  return addresses.some(isPrivateAddress) ? "resolves_to_private_address" : null;
}

export const URL_PROBLEM_MESSAGES: Record<UrlProblem, string> = {
  malformed: "is not a valid URL.",
  not_https: "must use https — the payload and its signature are sent in the request body.",
  credentials_in_url: "must not embed a username or password.",
  literal_private_address: "points at a private or reserved address, which this system will not call.",
  blocked_hostname: "points at a local or internal hostname, which this system will not call.",
  unresolvable: "does not resolve to any address.",
  resolves_to_private_address: "resolves to a private or reserved address, which this system will not call.",
};
