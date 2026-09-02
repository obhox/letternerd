/**
 * The value every editorial server action returns.
 *
 * Actions return failures rather than throwing them. An exception crossing the
 * server-action boundary is replaced in production by an opaque digest, which
 * would discard exactly the part worth showing — the count of documents that
 * blocked an author deletion, or the chain a new redirect just created.
 */
export interface EditorialState {
  /** Set only after a failed attempt. Rendered in a `role="alert"` region. */
  error: string | null;
  /** Succeeded, but with something the editor should read. Not a failure. */
  warnings: string[];
  /** A one-line confirmation, cleared on the next submit. */
  message: string | null;
}

export const INITIAL_STATE: EditorialState = { error: null, warnings: [], message: null };

export function failed(error: string): EditorialState {
  return { error, warnings: [], message: null };
}

export function succeeded(message: string, warnings: string[] = []): EditorialState {
  return { error: null, warnings, message };
}

/**
 * Turn a capability failure into something worth reading.
 *
 * The capability's own message is used wherever it is already written for a
 * person — the deletion refusal names the author and the count, and no
 * rewording here would improve on it. Only the codes whose message is aimed at
 * an API caller get replaced.
 */
export function messageFor(failure: { code: string; message: string }): string {
  switch (failure.code) {
    case "forbidden":
      return "Your role on this site does not allow that.";
    case "not_found":
      return "That item no longer exists. Reload the page and try again.";
    default:
      return failure.message;
  }
}

/** Form fields arrive as strings; an empty one means "clear", not "keep". */
export function optionalText(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

/** One entry per non-empty line, for the textarea-backed list fields. */
export function lines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
