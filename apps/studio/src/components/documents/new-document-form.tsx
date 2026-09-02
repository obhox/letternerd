"use client";

import Link from "next/link";
import { useActionState, useId, useState, type FormEvent } from "react";
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
} from "@cms/ui";
import {
  EMPTY_CREATE_STATE,
  isValidSlug,
  slugify,
  SLUG_MAX_LENGTH,
  SLUG_RULE,
  type CreateDocumentState,
} from "./create-document";
import { DOCUMENT_TYPES, TYPE_META, type DocumentType } from "./types";

export interface NewDocumentFormProps {
  /** Bound server action — the site slug is already applied. */
  action: (state: CreateDocumentState, formData: FormData) => Promise<CreateDocumentState>;
  initialType: DocumentType;
  cancelHref: string;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function NewDocumentForm({ action, initialType, cancelHref }: NewDocumentFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_CREATE_STATE);
  const slugId = useId();

  const [type, setType] = useState<DocumentType>(initialType);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugInvalid, setSlugInvalid] = useState(false);

  /**
   * The slug follows the title until someone takes it over.
   *
   * Deriving it forever would silently rewrite a URL an author chose
   * deliberately — and for a document that has been published the slug *is*
   * the URL, so that is not a cosmetic overwrite. Once edited, it is theirs.
   */
  const [slugOwned, setSlugOwned] = useState(false);

  /**
   * Every field is controlled, because React resets an uncontrolled form once
   * its action settles: a rejected submission would clear the four things the
   * author just typed, which is the moment they least deserve to lose them.
   * The action echoes the values back and they are reinstated here, during
   * render rather than in an effect so the blank frame never paints.
   */
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const values = state.values;
    if (values) {
      setType(values.type);
      setTitle(values.title);
      setSlug(values.slug);
      setDescription(values.description);
      setSlugOwned(values.slug.length > 0);
      setSlugInvalid(false);
    }
  }

  function onTitleChange(next: string): void {
    setTitle(next);
    if (!slugOwned) setSlug(slugify(next));
  }

  function onSlugChange(next: string): void {
    // Emptying the field hands the link back, rather than leaving an author
    // with a permanently blank slug they now have to type out by hand.
    setSlugOwned(next.trim().length > 0);
    setSlug(next);
    setSlugInvalid(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    // `required` already covers the empty case with the browser's own message.
    // This catches the shape the capability would reject, before a round trip
    // that could only tell us the same thing more slowly.
    const trimmed = slug.trim();
    if (trimmed.length > 0 && !isValidSlug(trimmed)) {
      event.preventDefault();
      setSlugInvalid(true);
      document.getElementById(slugId)?.focus();
    }
  }

  const slugError = slugInvalid
    ? `That slug is not valid. ${SLUG_RULE}`
    : state.fieldErrors?.slug;

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4">
      {state.message !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--color-surface))] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {state.message}
        </p>
      )}

      <Field label="Title" required error={state.fieldErrors?.title}>
        {({ id, "aria-describedby": describedBy, "aria-invalid": invalid }) => (
          <Input
            id={id}
            name="title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            maxLength={300}
            required
            autoFocus
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <Field id={slugId} label="Slug" required description={SLUG_RULE} error={slugError}>
        {({ id, "aria-describedby": describedBy, "aria-invalid": invalid }) => (
          <Input
            id={id}
            name="slug"
            value={slug}
            onChange={(event) => onSlugChange(event.target.value)}
            onBlur={() => {
              const trimmed = slug.trim();
              setSlugInvalid(trimmed.length > 0 && !isValidSlug(trimmed));
            }}
            maxLength={SLUG_MAX_LENGTH}
            required
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <Field
        label="Description"
        description="Becomes the meta description. 120–158 characters."
        error={state.fieldErrors?.description}
      >
        {({ id, "aria-describedby": describedBy, "aria-invalid": invalid }) => (
          <Textarea
            id={id}
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={400}
            rows={3}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <Field label="Type">
        {({ id }) => (
          <>
            <Select value={type} onValueChange={(value) => setType(value as DocumentType)}>
              <SelectTrigger id={id} className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {titleCase(TYPE_META[value].singular)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Radix's Select is a listbox, not a native control, so this
                hidden input is what actually reaches the action's FormData. */}
            <input type="hidden" name="type" value={type} />
          </>
        )}
      </Field>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner size="sm" />}
          Create {TYPE_META[type].singular}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
