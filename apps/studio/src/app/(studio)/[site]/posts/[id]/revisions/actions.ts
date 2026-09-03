"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";
import {
  failed,
  messageFor,
  succeeded,
  type EditorialState,
} from "@/components/editorial/action-state";

/**
 * Restoring a revision.
 *
 * The action holds no rules of its own — `restore_revision` decides who may
 * call it, snapshots the current state before overwriting, and refuses to
 * touch anything that would change the live page. All that is left here is
 * turning a form post into a capability call and a sentence.
 */

interface RestoreResult {
  restoredFrom: number;
  undoRevisionNumber: number;
}

export async function restoreRevisionAction(
  _previous: EditorialState,
  formData: FormData,
): Promise<EditorialState> {
  const site = String(formData.get("site") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const revisionNumber = Number(formData.get("revisionNumber"));

  if (!Number.isInteger(revisionNumber)) {
    return failed("That revision number is not valid. Reload the page and try again.");
  }

  const ctx = await studioContext(site);
  const result = await dispatch<RestoreResult>(ctx, "restore_revision", {
    documentId,
    revisionNumber,
  });

  if (!result.ok) return failed(messageFor(result));

  // Both screens change: the history gains the safety revision, and the editor
  // is now showing markdown that is no longer what the server holds.
  revalidatePath(`/${site}/posts/${documentId}/revisions`);
  revalidatePath(`/${site}/posts/${documentId}`);

  /**
   * The confirmation says the two things a person needs afterwards: how to get
   * back if this was the wrong number, and that nothing has gone live. The
   * second is a warning rather than part of the message because it is the
   * expectation most likely to be wrong.
   */
  return succeeded(
    `Restored revision ${result.data.restoredFrom}. The previous text was saved as revision ${result.data.undoRevisionNumber}, so this is undoable.`,
    ["The published page has not changed. Publish the post when the restored text is ready."],
  );
}
