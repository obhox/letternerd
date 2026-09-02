/**
 * XML escaping, applied to every interpolated value without exception.
 *
 * Titles contain ampersands, quotes and the occasional angle bracket, and a
 * feed or sitemap that fails to parse fails silently: Search Console reports
 * "couldn't fetch", a feed reader shows nothing, and nobody finds out for
 * weeks. Escaping at the point of interpolation — rather than trusting callers
 * to have done it — is the only version of this that stays true.
 */
export function escapeXml(value: string): string {
  return stripControlCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * XML 1.0 cannot represent most control characters at all — not escaped, not
 * as a numeric reference. One of them, pasted in from a word processor along
 * with the text of a title, invalidates the entire document rather than the
 * element it landed in, so they are dropped before anything else happens.
 * Tab, newline and carriage return are the three that are legal.
 */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const legal = code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    if (legal) out += char;
  }
  return out;
}

/**
 * Wraps content in CDATA, defusing the one sequence that can end the section.
 *
 * `]]>` cannot be escaped inside CDATA; the only way through is to close and
 * reopen around it. HTML bodies that happen to contain it are rare, and the
 * resulting unparseable feed is not, so this is unconditional.
 */
export function cdata(value: string): string {
  return `<![CDATA[${stripControlCharacters(value).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** RFC-822, in UTC, as RSS 2.0 requires. Unparseable input yields "". */
export function rfc822(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} GMT`
  );
}

/** ISO-8601 in UTC, for Atom and for `<lastmod>`. Unparseable input yields "". */
export function iso8601(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
