"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { HistoryIcon, RotateCcwIcon } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
} from "@cms/ui";
import { INITIAL_STATE, type EditorialState } from "@/components/editorial/action-state";
import { FormStatus } from "@/components/editorial/form-status";
import { collapseContext, diffLines, type DiffLine } from "./diff";

/**
 * Revision history, with restore.
 *
 * Two things make this screen safe to use rather than merely functional.
 *
 * Each row shows what restoring it would actually change — a diff against the
 * current body, not the revision on its own. A list of timestamps gives no way
 * to tell revision 11 from revision 12, and "restore and see" is not an
 * acceptable way to find out.
 *
 * And the confirmation says the two things people get wrong: that the current
 * text is kept (so a mistake here is undoable), and that the live page does
 * not move (so restoring is not a way to roll back a bad publish). Both are
 * properties of `restore_revision` itself; the dialog only reports them.
 */

export interface RevisionView {
  id: string;
  revisionNumber: number;
  title: string;
  description: string;
  bodyMd: string;
  note: string;
  createdAt: string | null;
}

type Action = (state: EditorialState, formData: FormData) => Promise<EditorialState>;

/**
 * Formatted in UTC with an explicit locale.
 *
 * An audit trail whose timestamps depend on which machine rendered them is an
 * audit trail two people can read differently, so the zone is stated rather
 * than inherited.
 */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : `${WHEN.format(date)} UTC`;
}

export function RevisionsScreen({
  site,
  documentId,
  documentTitle,
  currentBodyMd,
  currentStatus,
  revisions,
  restoreAction,
}: {
  site: string;
  documentId: string;
  documentTitle: string;
  currentBodyMd: string;
  currentStatus: string;
  revisions: RevisionView[];
  restoreAction: Action;
}) {
  const [state, formAction, isPending] = useActionState(restoreAction, INITIAL_STATE);
  const [confirming, setConfirming] = useState<RevisionView | null>(null);

  /**
   * Close on success, stay open on failure.
   *
   * A dialog that closes either way hides the error it caused — the person is
   * returned to a list that looks unchanged with no explanation.
   */
  useEffect(() => {
    if (state.message) setConfirming(null);
  }, [state.message]);

  return (
    <div className="flex flex-col gap-4">
      <FormStatus state={state} />

      {revisions.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No revisions yet"
          description="One is written the first time this post is edited, and again before any restore."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {revisions.map((revision) => (
            <RevisionCard
              key={revision.id}
              revision={revision}
              currentBodyMd={currentBodyMd}
              onRestore={() => setConfirming(revision)}
              disabled={isPending}
            />
          ))}
        </ol>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirming(null);
        }}
      >
        <DialogContent>
          {confirming && (
            <form action={formAction} className="contents">
              <input type="hidden" name="site" value={site} />
              <input type="hidden" name="documentId" value={documentId} />
              <input type="hidden" name="revisionNumber" value={confirming.revisionNumber} />

              <DialogHeader>
                <DialogTitle>Restore revision {confirming.revisionNumber}?</DialogTitle>
                <DialogDescription>
                  The title, description and markdown of{" "}
                  <span className="font-medium text-[var(--color-ink)]">
                    {documentTitle || "this post"}
                  </span>{" "}
                  will be replaced with this revision&rsquo;s.
                </DialogDescription>
              </DialogHeader>

              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-[var(--color-ink-muted)]">
                <li>
                  The text as it stands now is saved as a new revision first, so you can restore
                  your way back out of this.
                </li>
                <li>
                  {currentStatus === "published" || currentStatus === "scheduled" ? (
                    <>
                      This post is {currentStatus}, and{" "}
                      <span className="font-medium text-[var(--color-ink)]">
                        the live page will not change
                      </span>
                      . Restoring edits the draft text only — publish when you are ready for
                      readers to see it.
                    </>
                  ) : (
                    <>
                      Nothing is published by this. The post stays a {currentStatus || "draft"}.
                    </>
                  )}
                </li>
                <li>The slug and the URL are untouched.</li>
              </ul>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(null)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Restoring…" : `Restore revision ${confirming.revisionNumber}`}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RevisionCard({
  revision,
  currentBodyMd,
  onRestore,
  disabled,
}: {
  revision: RevisionView;
  currentBodyMd: string;
  onRestore: () => void;
  disabled: boolean;
}) {
  // Diffing every revision against the current body up front would be N passes
  // over the whole document on first paint; memoising per card keeps it to the
  // ones React actually renders and to one pass when the list re-renders.
  const diff = useMemo(
    () => diffLines(currentBodyMd, revision.bodyMd),
    [currentBodyMd, revision.bodyMd],
  );
  const collapsed = useMemo(() => collapseContext(diff.lines), [diff.lines]);
  const when = formatWhen(revision.createdAt);

  return (
    <li className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Revision {revision.revisionNumber}</Badge>
        {when && <span className="text-xs text-[var(--color-ink-muted)]">{when}</span>}

        {/*
          The change count, not the character count. "12,431 characters" is a
          fact about the revision; "+4 −1" is the answer to the question the
          person came here with.
        */}
        {diff.tooLarge ? (
          <span className="text-xs text-[var(--color-ink-muted)]">too long to compare</span>
        ) : diff.identical ? (
          <span className="text-xs text-[var(--color-ink-muted)]">
            identical to the current text
          </span>
        ) : (
          <span className="font-[family-name:var(--font-mono)] text-xs">
            <span className="text-[var(--color-ok)]">+{diff.added}</span>{" "}
            <span className="text-[var(--color-danger)]">&minus;{diff.removed}</span>
          </span>
        )}

        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={onRestore}
          disabled={disabled || diff.identical}
          title={
            diff.identical
              ? "This revision is the same as the current text."
              : `Restore revision ${revision.revisionNumber}`
          }
        >
          <RotateCcwIcon className="size-3.5" aria-hidden="true" />
          Restore
        </Button>
      </div>

      <p className="mt-1 truncate text-sm font-medium">
        {revision.title || <span className="italic">Untitled</span>}
      </p>

      {revision.description.length > 0 && (
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{revision.description}</p>
      )}

      {revision.note.length > 0 && (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Note: {revision.note}</p>
      )}

      {/*
        Collapsed by default. Fifty revisions of a long post is a great deal of
        markdown to scroll past to reach the one you are looking for.
      */}
      <details className="mt-2">
        <summary className="ui-focus-ring cursor-pointer rounded text-xs text-[var(--color-accent)]">
          {diff.tooLarge || diff.identical
            ? "Show the markdown as it was"
            : "Show what restoring this would change"}
        </summary>

        {diff.tooLarge || diff.identical ? (
          <pre className="ui-scroll mt-2 max-h-80 overflow-auto rounded-md bg-[var(--color-muted)] p-3 font-[family-name:var(--font-mono)] text-xs whitespace-pre-wrap">
            {revision.bodyMd}
          </pre>
        ) : (
          <>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
              Lines marked <span className="text-[var(--color-danger)]">&minus;</span> are in the
              current text and would go;{" "}
              <span className="text-[var(--color-ok)]">+</span> lines would come back.
            </p>
            <div className="ui-scroll mt-2 max-h-80 overflow-auto rounded-md bg-[var(--color-muted)] p-1 font-[family-name:var(--font-mono)] text-xs">
              {collapsed.map((line, index) =>
                line.kind === "gap" ? (
                  <p
                    key={`gap-${index}`}
                    className="px-2 py-1 text-center text-[var(--color-ink-muted)] select-none"
                  >
                    ⋯ {line.skipped} unchanged {line.skipped === 1 ? "line" : "lines"}
                  </p>
                ) : (
                  <DiffRow key={`line-${index}`} line={line} />
                ),
              )}
            </div>
          </>
        )}
      </details>
    </li>
  );
}

const ROW_STYLE: Record<DiffLine["kind"], string> = {
  added:
    "bg-[color-mix(in_oklch,var(--color-ok)_14%,transparent)] text-[var(--color-ink)] before:text-[var(--color-ok)] before:content-['+']",
  removed:
    "bg-[color-mix(in_oklch,var(--color-danger)_14%,transparent)] text-[var(--color-ink)] before:text-[var(--color-danger)] before:content-['−']",
  // A leading space keeps unchanged lines aligned with the marked ones.
  context: "text-[var(--color-ink-muted)] before:content-['\\00a0']",
};

function DiffRow({ line }: { line: DiffLine }) {
  return (
    <p
      className={`px-2 whitespace-pre-wrap before:mr-2 before:inline-block before:w-2 before:select-none ${ROW_STYLE[line.kind]}`}
    >
      {line.text || " "}
    </p>
  );
}
