"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";

/**
 * The two mutations the media grid performs from the browser.
 *
 * Uploads go through a route handler instead, because they need per-file
 * progress and a server action gives the client no way to observe the request
 * as it uploads. Everything else is small enough to be an action, and an action
 * avoids inventing a second authorization path — `dispatch` is the same door
 * the MCP server and the REST API come through.
 */

export interface ActionResult {
  ok: boolean;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export async function saveAltTextAction(
  siteSlug: string,
  input: { id: string; alt?: string; caption?: string | null; credit?: string | null },
): Promise<ActionResult> {
  const ctx = await studioContext(siteSlug);
  const result = await dispatch(ctx, "set_alt_text", input);

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  // The missing-alt count in the header is server-rendered, so it has to be
  // recomputed here — otherwise clearing the last item leaves the page still
  // claiming there is work outstanding.
  revalidatePath(`/${siteSlug}/media`);
  return { ok: true };
}

export async function deleteMediaAction(
  siteSlug: string,
  id: string,
): Promise<ActionResult> {
  const ctx = await studioContext(siteSlug);
  const result = await dispatch(ctx, "delete_media", { id });

  if (!result.ok) {
    // A `conflict` here is the in-use refusal, and its details name the
    // documents. Passed through untouched so the dialog can list them.
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(`/${siteSlug}/media`);
  return { ok: true };
}
