"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";
import {
  failed,
  lines,
  messageFor,
  optionalText,
  succeeded,
  type EditorialState,
} from "@/components/editorial/action-state";

/**
 * Author writes, as server actions.
 *
 * Neither of these contains a permission check or a scoping rule. They read a
 * form, resolve the site from the URL segment, and dispatch — the capability
 * decides whether this actor may do it, and the same decision is made when the
 * call arrives over MCP instead.
 */

function siteOf(formData: FormData): string {
  return String(formData.get("site") ?? "");
}

export async function saveAuthorAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = siteOf(formData);
  const ctx = await studioContext(site);

  const id = optionalText(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();

  /**
   * An empty account field means "no account", and that is a real answer.
   *
   * On a new author it is the guest case and the field is simply left off. On
   * an existing one it is a deliberate unlink, so null is sent explicitly —
   * the capability distinguishes "absent" from "null", and sending nothing
   * here would quietly keep a departed employee's login attached.
   */
  const userId = optionalText(formData.get("userId"));
  const linkedBefore = formData.get("hadUserId") === "1";

  const input = {
    ...(id ? { id } : {}),
    slug: String(formData.get("slug") ?? "").trim(),
    name,
    ...(userId ? { userId } : linkedBefore ? { userId: null } : {}),
    jobTitle: optionalText(formData.get("jobTitle")),
    bioMd: optionalText(formData.get("bioMd")),
    avatarAssetId: optionalText(formData.get("avatarAssetId")),
    email: optionalText(formData.get("email")),
    url: optionalText(formData.get("url")),
    sameAs: formData
      .getAll("sameAs")
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0),
    knowsAbout: lines(formData.get("knowsAbout")),
    isActive: formData.get("isActive") === "on",
  };

  const result = await dispatch(ctx, "upsert_author", input);
  if (!result.ok) return failed(messageFor(result));

  revalidatePath(`/${site}/authors`);
  return succeeded(id ? `Saved ${name}.` : `Created ${name}.`);
}

export async function deleteAuthorAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = siteOf(formData);
  const ctx = await studioContext(site);

  const reassignToId = optionalText(formData.get("reassignToId"));
  const result = await dispatch(ctx, "delete_author", {
    id: String(formData.get("id") ?? ""),
    ...(reassignToId ? { reassignToId } : {}),
  });

  // The refusal message names the author and the number of documents still
  // crediting them, which is exactly what the editor needs in order to choose
  // between reassigning and deactivating. Passing it through unchanged.
  if (!result.ok) return failed(messageFor(result));

  revalidatePath(`/${site}/authors`);
  return succeeded(
    reassignToId ? "Author deleted and their credits reassigned." : "Author deleted.",
  );
}
