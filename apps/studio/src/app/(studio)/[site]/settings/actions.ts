"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";

/**
 * Every settings mutation, as a server action.
 *
 * None of these touches the database. They resolve the site, then call
 * `dispatch`, which is the same door the MCP server, the REST API and the CLI
 * come through — so the last-owner rule and the owner-only checks are enforced
 * once, in the capability, rather than restated here where they could drift.
 *
 * Failures come back as values, not exceptions. An exception crossing the
 * server-action boundary in production is replaced by an opaque digest, which
 * would strip exactly the message the person needs — "this is the site's only
 * owner" is the whole point of that refusal.
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

async function call<T>(
  siteSlug: string,
  capability: string,
  input: unknown,
  revalidate: string[],
): Promise<ActionResult<T>> {
  const ctx = await studioContext(siteSlug);
  const result = await dispatch<T>(ctx, capability, input);

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  for (const path of revalidate) revalidatePath(path);
  return { ok: true, data: result.data };
}

export async function updateSiteAction(
  siteSlug: string,
  input: Record<string, unknown>,
): Promise<ActionResult> {
  // The whole studio shell renders the site name and baseUrl, so a settings
  // save that revalidated only this page would leave the header stale.
  return call(siteSlug, "update_site", input, [`/${siteSlug}`, `/${siteSlug}/settings`]);
}

export interface CreatedKey {
  key: { id: string; name: string; keyPrefix: string; type: string };
  plaintext: string;
  notice: string;
}

export async function createApiKeyAction(
  siteSlug: string,
  input: { name: string; type: string; allowedOrigins?: string[]; expiresInDays?: number },
): Promise<ActionResult<CreatedKey>> {
  return call<CreatedKey>(siteSlug, "create_api_key", input, [`/${siteSlug}/settings/api-keys`]);
}

export async function revokeApiKeyAction(siteSlug: string, id: string): Promise<ActionResult> {
  return call(siteSlug, "revoke_api_key", { id }, [`/${siteSlug}/settings/api-keys`]);
}

export interface CreatedInvitation {
  invitation: { email: string; role: string; expiresAt: string };
  acceptPath: string;
  notice: string;
}

export async function inviteMemberAction(
  siteSlug: string,
  input: { email: string; role: string },
): Promise<ActionResult<CreatedInvitation>> {
  return call<CreatedInvitation>(siteSlug, "invite_member", input, [
    `/${siteSlug}/settings/members`,
  ]);
}

export async function updateMemberRoleAction(
  siteSlug: string,
  userId: string,
  role: string,
): Promise<ActionResult> {
  return call(siteSlug, "update_member_role", { userId, role }, [`/${siteSlug}/settings/members`]);
}

export async function removeMemberAction(
  siteSlug: string,
  userId: string,
): Promise<ActionResult> {
  return call(siteSlug, "remove_member", { userId }, [`/${siteSlug}/settings/members`]);
}

export interface SavedWebhook {
  webhook: { id: string; url: string; events: string[]; isActive: boolean };
  secret?: string;
  notice: string | null;
}

export async function upsertWebhookAction(
  siteSlug: string,
  input: { id?: string; url: string; events: string[]; isActive?: boolean; rotateSecret?: boolean },
): Promise<ActionResult<SavedWebhook>> {
  return call<SavedWebhook>(siteSlug, "upsert_webhook", input, [`/${siteSlug}/settings/webhooks`]);
}

export async function deleteWebhookAction(siteSlug: string, id: string): Promise<ActionResult> {
  return call(siteSlug, "delete_webhook", { id }, [`/${siteSlug}/settings/webhooks`]);
}
