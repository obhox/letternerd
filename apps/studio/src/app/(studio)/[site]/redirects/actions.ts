"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";
import {
  failed,
  messageFor,
  optionalText,
  succeeded,
  type EditorialState,
} from "@/components/editorial/action-state";

/**
 * Redirect writes.
 *
 * There is deliberately no action here that touches slug history. Those rows
 * are written by `update_document` when a published slug changes and there is
 * no capability that edits one, so there is nothing for a form to post to.
 */

interface UpsertRedirectResult {
  redirect: { source: string; destination: string };
  warnings: Array<{ code: string; message: string }>;
}

export async function saveRedirectAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = String(formData.get("site") ?? "");
  const ctx = await studioContext(site);
  const id = optionalText(formData.get("id"));

  const result = await dispatch<UpsertRedirectResult>(ctx, "upsert_redirect", {
    ...(id ? { id } : {}),
    source: String(formData.get("source") ?? ""),
    destination: String(formData.get("destination") ?? ""),
    statusCode: Number(formData.get("statusCode") ?? 301),
  });

  if (!result.ok) return failed(messageFor(result));

  revalidatePath(`/${site}/redirects`);

  /**
   * A chain is reported, not refused.
   *
   * Two hops still resolve, and the person writing the rule may be about to
   * delete the middle one. But each hop is a place a crawler can decide not to
   * follow, so the warning is shown next to the saved rule rather than
   * swallowed.
   */
  return succeeded(
    `Saved ${result.data.redirect.source} → ${result.data.redirect.destination}.`,
    result.data.warnings.map((warning) => warning.message),
  );
}

export async function deleteRedirectAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = String(formData.get("site") ?? "");
  const ctx = await studioContext(site);

  const result = await dispatch(ctx, "delete_redirect", {
    id: String(formData.get("id") ?? ""),
  });
  if (!result.ok) return failed(messageFor(result));

  revalidatePath(`/${site}/redirects`);
  return succeeded("Rule deleted. That path returns 404 again.");
}
