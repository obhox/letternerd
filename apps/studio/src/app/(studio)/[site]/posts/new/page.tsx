import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@cms/ui";
import { dispatch, studioContext } from "@/server/context";
import {
  asDocumentType,
  isValidSlug,
  SLUG_RULE,
  type CreateDocumentState,
  type CreateDocumentValues,
} from "@/components/documents/create-document";
import { NewDocumentForm } from "@/components/documents/new-document-form";
import { editorHref, TYPE_META } from "@/components/documents/types";
import type { RawSearchParams } from "@/components/documents/search-params";

export const metadata: Metadata = { title: "New document" };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Create a draft and go straight to its editor.
 *
 * Validation is repeated rather than delegated: the browser check keeps a
 * typo from costing a round trip, and this one is the check that actually
 * counts, because a form is not a security boundary and `create_document`
 * would reject the same input anyway.
 */
async function createDocumentAction(
  siteSlug: string,
  _previous: CreateDocumentState,
  formData: FormData,
): Promise<CreateDocumentState> {
  "use server";

  const values: CreateDocumentValues = {
    type: asDocumentType(formData.get("type")),
    title: text(formData, "title"),
    slug: text(formData, "slug"),
    description: text(formData, "description"),
  };

  if (values.title.length === 0) {
    return { values, fieldErrors: { title: "A title is required." } };
  }
  if (!isValidSlug(values.slug)) {
    return { values, fieldErrors: { slug: `That slug is not valid. ${SLUG_RULE}` } };
  }

  const ctx = await studioContext(siteSlug);
  const result = await dispatch<{ id: string }>(ctx, "create_document", {
    type: values.type,
    slug: values.slug,
    title: values.title,
    ...(values.description.length > 0 && { description: values.description }),
  });

  if (!result.ok) {
    if (result.code === "conflict") {
      // Named, and next to the field that caused it: "already exists" without
      // the slug leaves the author guessing which of the two they must change.
      return {
        values,
        fieldErrors: {
          slug: `"${values.slug}" is already taken by another ${TYPE_META[values.type].singular} on this site. Choose a different slug.`,
        },
      };
    }
    return { values, message: result.message };
  }

  // Outside the failure branch on purpose: `redirect` works by throwing, so it
  // must not sit anywhere a catch could swallow it.
  redirect(editorHref(siteSlug, { id: result.data.id, type: values.type }));
}

export default async function NewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ site }, resolvedSearchParams] = await Promise.all([params, searchParams]);

  // Membership is re-checked before the form renders, so an author who cannot
  // write here is turned away at the door rather than after typing a draft.
  await studioContext(site);

  const rawType = resolvedSearchParams.type;
  const initialType = asDocumentType(Array.isArray(rawType) ? rawType[0] : rawType);
  const section = TYPE_META[initialType].section;

  return (
    <div className="flex flex-col gap-4">
      {/* Kept deliberately against the copy trim: a "New post" screen with a
          create button reads as though it publishes. Saying otherwise costs one
          line and prevents a surprise that is awkward to undo. */}
      <PageHeader
        title={`New ${TYPE_META[initialType].singular}`}
        description="Creates a draft. Nothing goes live until you publish."
        className="pb-0"
      />
      <NewDocumentForm
        action={createDocumentAction.bind(null, site)}
        initialType={initialType}
        cancelHref={`/${site}/${section}`}
      />
    </div>
  );
}
