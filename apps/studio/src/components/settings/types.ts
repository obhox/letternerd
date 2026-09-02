import type { PublicApiKey } from "@cms/capabilities";

/**
 * The shapes the settings screens hand to their client components.
 *
 * Derived from the capability's own types wherever one exists, so a column
 * added to `list_api_keys` cannot leave a hand-copied field list behind — that
 * kind of copy typechecks happily right up until the day it is wrong.
 *
 * The transformation these apply is dates to ISO strings. Server components
 * render on the server and these props cross into the browser bundle, where a
 * `Date` formats differently depending on whose machine produced it.
 */

const DATE_FIELDS = ["lastUsedAt", "expiresAt", "revokedAt", "createdAt"] as const;

/** `PublicApiKey`, with its timestamps flattened for the client boundary. */
export type ApiKeyView = Omit<PublicApiKey, (typeof DATE_FIELDS)[number]> & {
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

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
