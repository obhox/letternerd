import { DOCUMENT_TYPES, type DocumentType } from "./types";

/**
 * The vocabulary shared by the create form and the server action behind it.
 *
 * Both halves have to agree on what a valid slug is, and the capability is the
 * third party that actually decides. Copying its regex here rather than
 * inventing a looser one means the form refuses exactly what the capability
 * would refuse, instead of letting a request through to fail confusingly.
 */

/** Mirrors `create_document`'s own `slug` regex. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Stated up front as help text, not only after a failed attempt. A rule a
 * person can read while typing prevents the error; a rule revealed on submit
 * only explains it.
 */
export const SLUG_RULE =
  "Lowercase letters and numbers, separated by single hyphens.";

/** Matches the capability's `max(200)`. */
export const SLUG_MAX_LENGTH = 200;

/**
 * Best-effort slug for a title. Deliberately lossy: accents are folded, every
 * run of anything else becomes one hyphen.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    // Combining marks, left behind by the decomposition above.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    // The truncation can leave a trailing hyphen the pattern rejects.
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

export function asDocumentType(value: unknown): DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value)
    ? (value as DocumentType)
    : "post";
}

export interface CreateDocumentValues {
  type: DocumentType;
  title: string;
  slug: string;
  description: string;
}

/**
 * What the server action hands back to the form.
 *
 * Failures are values rather than exceptions all the way through — `dispatch`
 * is built that way precisely so a conflict can be rendered next to the field
 * that caused it instead of becoming an error page.
 */
export interface CreateDocumentState {
  /** A problem that belongs to the form as a whole, not to one field. */
  message?: string;
  fieldErrors?: {
    title?: string;
    slug?: string;
    description?: string;
  };
  /** Echoed back so a rejected submission does not lose what was typed. */
  values?: CreateDocumentValues;
}

export const EMPTY_CREATE_STATE: CreateDocumentState = {};
