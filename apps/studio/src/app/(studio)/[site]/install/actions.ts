"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";

/**
 * The one mutation this guide performs: minting the read key it then tells you
 * to paste into `.env.local`.
 *
 * It goes through `dispatch` like every other write in the studio, so the
 * owner-only rule on `create_api_key` is enforced by the capability rather than
 * restated here — the button is hidden for an editor, and the server refuses
 * regardless. Presentation is not enforcement.
 *
 * Failures come back as values. An exception crossing the server-action
 * boundary in production is replaced by an opaque digest, and "your role does
 * not allow that" is exactly the message that must survive.
 */

export interface CreatedReadKey {
  key: { id: string; name: string; keyPrefix: string; type: string };
  /** Returned once, by this call, and never obtainable again. */
  plaintext: string;
  notice: string;
}

export interface InstallActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  message?: string;
}

export async function createReadKeyAction(
  siteSlug: string,
  name: string,
): Promise<InstallActionResult<CreatedReadKey>> {
  const ctx = await studioContext(siteSlug);

  // `read` — a cms_sk_ key — is what a server-rendering site needs: published
  // and draft-free content reads plus analytics, and no write of any kind. An
  // admin key here would let a leaked .env.local publish to the live site.
  const result = await dispatch<CreatedReadKey>(ctx, "create_api_key", {
    name,
    type: "read",
  });

  if (!result.ok) return { ok: false, message: result.message };

  // The listing on this page and the one in settings show the same rows.
  revalidatePath(`/${siteSlug}/install`);
  revalidatePath(`/${siteSlug}/settings/api-keys`);

  return { ok: true, data: result.data };
}
