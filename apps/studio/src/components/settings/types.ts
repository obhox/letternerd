/**
 * The shapes the settings screens hand to their client components.
 *
 * Local rather than imported from `@cms/capabilities`, because the registry
 * index does not re-export the settings module yet — the orchestrator wires
 * that. When it does, these should be replaced by the capability's own return
 * types: a hand-copied field list typechecks happily right up until someone
 * adds a column.
 *
 * Dates are ISO strings throughout. Server components render on the server and
 * these props cross into the browser bundle, where a `Date` becomes a value
 * that formats differently depending on whose machine rendered it.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  type: string;
  /** The only part of a key that is ever shown after creation. */
  keyPrefix: string;
  scopes: string[];
  allowedOrigins: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface MemberView {
  userId: string;
  role: string;
  email: string | null;
  name: string | null;
  createdAt: string;
}

export interface InvitationView {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export interface SiteSettingsView {
  name: string;
  baseUrl: string;
  blogBasePath: string;
  locale: string;
  orgName: string | null;
  orgLogoUrl: string | null;
  orgSameAs: string[];
  twitterHandle: string | null;
  feedTitle: string | null;
  feedDescription: string | null;
  robotsExtra: string | null;
  llmsIntro: string | null;
}
