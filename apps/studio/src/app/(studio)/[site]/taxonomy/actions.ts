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
import type { TermKind } from "@/components/editorial/types";

/** The three kinds share a form, so they share their actions too. */
function kindOf(formData: FormData): TermKind {
  const raw = String(formData.get("kind") ?? "tag");
  return raw === "category" || raw === "entity" ? raw : "tag";
}

export async function saveTermAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = String(formData.get("site") ?? "");
  const ctx = await studioContext(site);
  const kind = kindOf(formData);
  const id = optionalText(formData.get("id"));

  const base = {
    kind,
    ...(id ? { id } : {}),
    slug: String(formData.get("slug") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    description: optionalText(formData.get("description")),
  };

  const input =
    kind === "category"
      ? {
          ...base,
          parentId: optionalText(formData.get("parentId")),
          position: Number(formData.get("position") ?? 0) || 0,
        }
      : kind === "entity"
        ? {
            ...base,
            type: String(formData.get("type") ?? "Thing"),
            aliases: lines(formData.get("aliases")),
            sameAs: formData
              .getAll("sameAs")
              .map((value) => String(value).trim())
              .filter((value) => value.length > 0),
            // Sent as null rather than omitted, so clearing the field in the
            // form actually clears the column.
            wikidataId: optionalText(formData.get("wikidataId")),
          }
        : base;

  const result = await dispatch(ctx, "upsert_term", input);
  if (!result.ok) return failed(messageFor(result));

  revalidatePath(`/${site}/taxonomy`);
  return succeeded(id ? `Saved ${base.name}.` : `Created ${base.name}.`);
}

export async function deleteTermAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = String(formData.get("site") ?? "");
  const ctx = await studioContext(site);

  const result = await dispatch(ctx, "delete_term", {
    kind: kindOf(formData),
    id: String(formData.get("id") ?? ""),
  });
  if (!result.ok) return failed(messageFor(result));

  revalidatePath(`/${site}/taxonomy`);
  return succeeded("Deleted. The documents themselves are untouched.");
}
