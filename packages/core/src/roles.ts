/**
 * What each role may do.
 *
 * The rules live here, once, and every surface imports them — the studio's
 * server actions, the REST API, the MCP server and the CLI. A second,
 * separately-invented interpretation of "editor" is how one surface quietly
 * permits what another forbids.
 *
 * The hierarchy is strict: every capability of a lesser role belongs to a
 * greater one. That is worth stating because it makes `atLeast` sound — a
 * capability model with exceptions cannot be expressed as a rank comparison,
 * and pretending otherwise produces holes. There is exactly one exception in
 * this system (`writeOwnDocument`) and it is called out below.
 *
 *   author  own drafts: create, edit, submit for review. Upload media.
 *   editor  + publish/schedule anything, edit anything, taxonomy, authors,
 *            redirects, imports.
 *   owner   + site settings, members, API keys, webhooks, delete site.
 */

export const SITE_ROLES = ["owner", "editor", "author"] as const;

export type SiteRole = (typeof SITE_ROLES)[number];

/** Greater rank means strictly more capability. */
const RANK: Record<SiteRole, number> = {
  author: 0,
  editor: 1,
  owner: 2,
};

/**
 * An unrecognised role is treated as the least privileged one.
 *
 * Roles arrive from a database column, and a value written by an older or
 * newer version of the schema must not fail open. Defaulting to `author`
 * means the worst outcome is someone temporarily unable to publish, rather
 * than a stranger able to.
 */
export function rankOf(role: string): number {
  return RANK[role as SiteRole] ?? RANK.author;
}

export function atLeast(role: string, required: SiteRole): boolean {
  return rankOf(role) >= RANK[required];
}

export function isSiteRole(value: string): value is SiteRole {
  return (SITE_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<SiteRole, string> = {
  owner: "Owner",
  editor: "Editor",
  author: "Author",
};

export const ROLE_DESCRIPTIONS: Record<SiteRole, string> = {
  owner: "Everything, including site settings, members and API keys.",
  editor: "Publish and edit any content, manage taxonomy, authors and redirects.",
  author: "Write and edit their own drafts. Cannot publish.",
};

/** Named capabilities, so call sites read as intent rather than as rank maths. */
export const can = {
  /** Everyone with a membership. */
  read: (role: string) => atLeast(role, "author"),

  /**
   * Edit *some* document. The floor, not the whole check.
   *
   * This is the one capability that is not a pure rank comparison: an author
   * may edit a document they created, and no other. The full check is
   * `can.writeAnyDocument(role) || doc.createdBy === actor.id`, and it lives
   * in `assertCanWriteDocument` so the two halves cannot drift apart.
   */
  writeOwnDocument: (role: string) => atLeast(role, "author"),
  writeAnyDocument: (role: string) => atLeast(role, "editor"),

  publish: (role: string) => atLeast(role, "editor"),

  uploadMedia: (role: string) => atLeast(role, "author"),
  deleteMedia: (role: string) => atLeast(role, "editor"),

  manageTaxonomy: (role: string) => atLeast(role, "editor"),
  manageAuthors: (role: string) => atLeast(role, "editor"),
  manageRedirects: (role: string) => atLeast(role, "editor"),
  runImport: (role: string) => atLeast(role, "editor"),

  manageSite: (role: string) => atLeast(role, "owner"),
  manageMembers: (role: string) => atLeast(role, "owner"),
  manageApiKeys: (role: string) => atLeast(role, "owner"),
  manageWebhooks: (role: string) => atLeast(role, "owner"),
} satisfies Record<string, (role: string) => boolean>;

/**
 * Roles that may be handed out.
 *
 * `owner` is assignable — a site with exactly one owner is one lost account
 * away from being unadministrable — but only by an existing owner, which
 * `can.manageMembers` enforces.
 */
export const ASSIGNABLE_ROLES: SiteRole[] = ["owner", "editor", "author"];

/** Roles an invitation may carry. An invite cannot mint an owner. */
export const INVITABLE_ROLES: SiteRole[] = ["editor", "author"];
