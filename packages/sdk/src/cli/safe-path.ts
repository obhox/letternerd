import { resolve, sep } from "node:path";

/**
 * The line between "a file in this project" and "a file on this machine".
 *
 * A plan's paths come from a server. Usually that server is the studio the
 * caller named, but nothing about a URL and a bearer token proves it — a typo
 * in `--studio-url`, a compromised host or a hostile DNS answer all produce a
 * JSON body the CLI would otherwise write verbatim. A single entry of
 * `../../.bashrc`, `/etc/cron.d/x` or `.git/hooks/pre-commit` (absent in a
 * fresh clone, so the "already exists" rule would not save it) is code
 * execution on the developer's machine the next time they open a shell or
 * commit. So every path is judged twice: by its text, before anything is
 * resolved, and by where it lands, after.
 *
 * The text check is deliberately narrower than "what the filesystem would
 * accept". `.` and `..` segments, backslashes, drive letters and control
 * characters have no business in a plan that only ever writes `app/…`,
 * `lib/…` and `next.config.*`, and rejecting them by name gives a reason a
 * person can read rather than a resolved path they have to think about.
 */

/**
 * Directories no plan may write into, wherever they appear in the path.
 *
 * `.git` because a hook or a rewritten config is arbitrary code on the next
 * commit; `node_modules` because a file there runs on the next `require`. Both
 * are checked case-insensitively: macOS and Windows filesystems would happily
 * treat `.GIT/hooks` as `.git/hooks`.
 */
const FORBIDDEN_SEGMENTS = new Set([".git", "node_modules"]);

/** Any segment beginning `.env` — the env file holds secrets, and the CLI never writes it. */
const ENV_PREFIX = ".env";

/** A drive-letter prefix, `C:` — with or without a separator after it. */
const WINDOWS_DRIVE = /^[A-Za-z]:/;

/** NUL and the other C0 controls, plus DEL. None of these belong in a file name. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function unsafe(path: string, why: string): never {
  throw new Error(`Unsafe path ${JSON.stringify(path)}: ${why}.`);
}

/**
 * Throws unless `path` is a plain, forward-slash, project-relative path with
 * no way of escaping the directory it is resolved against.
 */
export function assertSafeRelativePath(path: string): void {
  if (path.length === 0) unsafe(path, "it is empty");
  if (CONTROL_CHARS.test(path)) unsafe(path, "it contains a control character");
  if (path.includes("\\")) unsafe(path, "backslashes are not allowed; use forward slashes");
  if (path.startsWith("/")) unsafe(path, "absolute paths are not allowed");
  if (WINDOWS_DRIVE.test(path)) unsafe(path, "drive-letter paths are not allowed");

  for (const segment of path.split("/")) {
    if (segment === "") unsafe(path, "it contains an empty segment");
    if (segment === "." || segment === "..") unsafe(path, "`.` and `..` segments are not allowed");

    const folded = segment.toLowerCase();
    if (FORBIDDEN_SEGMENTS.has(folded)) unsafe(path, `writing into \`${segment}\` is not allowed`);
    if (folded.startsWith(ENV_PREFIX)) {
      unsafe(path, "environment files hold secrets and are never written by this command");
    }
  }
}

/**
 * `resolve(root, relative)`, provided the result stays inside `root`.
 *
 * The text check above should make the prefix check redundant, and the prefix
 * check is there for the day it does not: a normalisation the text check did
 * not anticipate still has to land under `root`. The comparison is against
 * `root + sep`, not `root`, because `/srv/app` is a prefix of `/srv/app-evil`
 * and only one of those is inside the project.
 */
export function resolveInside(root: string, relative: string): string {
  assertSafeRelativePath(relative);

  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relative);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    unsafe(relative, `it resolves outside ${absoluteRoot}`);
  }
  return target;
}
