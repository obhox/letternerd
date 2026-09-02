"use client";

import { useId, useState, useTransition } from "react";
import { CheckIcon, CopyIcon, LinkIcon, Trash2Icon } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  cn,
} from "@cms/ui";
import {
  deleteMediaAction,
  saveAltTextAction,
} from "@/app/(studio)/[site]/media/actions";
import type { MediaCardAsset, ReferencingDocument } from "./types";

/**
 * One asset in the grid, built around its alt text.
 *
 * The alt field is the card's primary control rather than something behind a
 * detail view, because a missing alt is the only media problem that refuses a
 * publish, and it is cleared by someone looking at a wall of thumbnails and
 * typing what they see. Putting it one click away is how the backlog stays a
 * backlog.
 */
export function AssetCard({
  siteSlug,
  asset,
  canDelete,
}: {
  siteSlug: string;
  asset: MediaCardAsset;
  canDelete: boolean;
}) {
  const altId = useId();
  const [alt, setAlt] = useState(asset.alt);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const dirty = alt.trim() !== asset.alt.trim();
  const missing = asset.alt.trim().length === 0;

  function save() {
    if (!dirty || alt.trim().length === 0) return;
    setError(null);
    startSaving(async () => {
      const result = await saveAltTextAction(siteSlug, { id: asset.id, alt: alt.trim() });
      if (result.ok) {
        setSaved(true);
        // A tick of confirmation, then back to normal — a permanently green
        // field stops meaning anything once the whole grid is green.
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(result.message ?? "The alt text could not be saved.");
      }
    });
  }

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-[var(--color-surface)]",
        missing
          ? "border-[color-mix(in_oklch,var(--color-warn)_45%,var(--color-border))]"
          : "border-[var(--color-border)]",
      )}
    >
      <div className="relative">
        <img
          src={asset.fallbackSrc}
          srcSet={asset.srcsetAvif || asset.srcsetWebp || undefined}
          sizes="(max-width: 640px) 100vw, 240px"
          // Empty when the asset has none, which is the correct decorative
          // treatment rather than an invented one: the card renders the
          // filename as text directly below, so a screen reader is not left
          // without a way to tell these cards apart.
          alt={asset.alt || ""}
          // Intrinsic dimensions on every image, always. The browser reserves
          // the right box from the aspect ratio before a single byte of the
          // image arrives, so a grid of forty thumbnails settles once instead
          // of reflowing forty times as they decode.
          width={asset.width ?? undefined}
          height={asset.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="block aspect-[4/3] w-full object-cover"
          // The asset's own dominant colour stands in while it decodes, so the
          // grid reads as a page of images from the first paint rather than as
          // a page of grey rectangles.
          style={
            asset.placeholderColor ? { backgroundColor: asset.placeholderColor } : undefined
          }
        />
        {missing && (
          <Badge variant="warning" className="absolute top-2 left-2 shadow-sm">
            Needs alt text
          </Badge>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <label
            htmlFor={altId}
            className="text-xs font-medium text-[var(--color-ink-muted)]"
          >
            Alt text
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <Input
              id={altId}
              value={alt}
              placeholder="Describe what this image shows"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${altId}-error` : undefined}
              disabled={saving}
              onChange={(event) => {
                setAlt(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  save();
                }
              }}
            />
            {saving ? (
              <Spinner className="size-4 shrink-0 text-[var(--color-ink-muted)]" />
            ) : saved ? (
              <CheckIcon className="size-4 shrink-0 text-[var(--color-ok)]" aria-hidden="true" />
            ) : (
              <Button
                type="button"
                size="sm"
                variant={dirty ? "default" : "ghost"}
                disabled={!dirty || alt.trim().length === 0}
                onClick={save}
              >
                Save
              </Button>
            )}
          </div>
          {error && (
            <p id={`${altId}-error`} className="mt-1 text-xs text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>

        <p
          className="truncate text-xs text-[var(--color-ink-muted)]"
          title={asset.filename}
        >
          {asset.filename}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
        </p>

        <div className="mt-auto flex items-center gap-1 pt-1">
          <CopyRefButton reference={asset.ref} />
          {canDelete && <DeleteButton siteSlug={siteSlug} asset={asset} />}
        </div>
      </div>
    </article>
  );
}

/**
 * `media://<id>` is what goes into markdown, not a CDN URL — that is the whole
 * reason a CDN migration is an env var here rather than a rewrite of every
 * post. So the one-click copy has to hand over the ref, and the button says so.
 */
function CopyRefButton({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(reference);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access is refused in some contexts; selecting the text is
          // the fallback, and pretending it worked would be worse than silence.
          setCopied(false);
        }
      }}
      title={reference}
    >
      {copied ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <CopyIcon aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy ref"}
    </Button>
  );
}

function DeleteButton({
  siteSlug,
  asset,
}: {
  siteSlug: string;
  asset: MediaCardAsset;
}) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<{
    message: string;
    documents: ReferencingDocument[];
    truncated: boolean;
    count: number;
  } | null>(null);
  const [pending, startDeleting] = useTransition();

  function confirm() {
    setRefusal(null);
    startDeleting(async () => {
      const result = await deleteMediaAction(siteSlug, asset.id);
      if (result.ok) {
        setOpen(false);
        return;
      }

      if (result.code === "conflict") {
        const details = (result.details ?? {}) as {
          documents?: ReferencingDocument[];
          referenceCount?: number;
          truncated?: boolean;
        };
        setRefusal({
          message: result.message ?? "This image is still in use.",
          documents: details.documents ?? [],
          truncated: details.truncated === true,
          count: details.referenceCount ?? details.documents?.length ?? 0,
        });
        return;
      }

      setRefusal({
        message: result.message ?? "The asset could not be deleted.",
        documents: [],
        truncated: false,
        count: 0,
      });
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-danger)]"
        onClick={() => {
          setRefusal(null);
          setOpen(true);
        }}
      >
        <Trash2Icon aria-hidden="true" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {refusal && refusal.count > 0 ? "Still in use" : "Delete this image?"}
            </DialogTitle>
            <DialogDescription>
              {refusal
                ? refusal.message
                : `"${asset.filename}" and every rendition of it will be deleted permanently. There is no undo.`}
            </DialogDescription>
          </DialogHeader>

          {refusal && refusal.documents.length > 0 && (
            <div>
              {/* Naming them is the difference between a refusal an editor can
                  act on and one they have to investigate. */}
              <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] text-sm">
                {refusal.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2 px-3 py-2">
                    <LinkIcon
                      className="size-3.5 shrink-0 text-[var(--color-ink-muted)]"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                      {doc.title || doc.slug}
                    </span>
                    <Badge variant="outline">{doc.status}</Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                {refusal.truncated
                  ? `Showing ${refusal.documents.length} of ${refusal.count}. `
                  : ""}
                Remove the <code className="font-mono">{asset.ref}</code> reference from
                {refusal.count === 1 ? " it" : " them"} first.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {refusal && refusal.count > 0 ? "Close" : "Cancel"}
            </Button>
            {!(refusal && refusal.count > 0) && (
              <Button type="button" variant="danger" disabled={pending} onClick={confirm}>
                {pending ? <Spinner className="size-4" /> : <Trash2Icon aria-hidden="true" />}
                Delete permanently
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
