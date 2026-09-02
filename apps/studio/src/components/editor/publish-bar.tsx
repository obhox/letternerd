"use client";

import Link from "next/link";
import { ClockIcon, HistoryIcon, SaveIcon, SendIcon } from "lucide-react";
import { Badge, Button, Input, Spinner, StatusBadge, type DocumentStatus } from "@cms/ui";

/**
 * Save state, publish and scheduling.
 *
 * The save indicator is deliberately wordy. Autosave that happens invisibly is
 * autosave nobody trusts, and the first thing an author does when they cannot
 * see it is press Ctrl-S and then wonder whether that worked either. So the
 * bar always says which of the four states it is in — unsaved, saving, saved
 * at a time, or failed — and never leaves the fourth silent.
 */

export interface PublishBarProps {
  status: DocumentStatus;
  canPublish: boolean;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  lastSavedAt: Date | null;
  saveError: string | null;
  scheduleAt: string;
  onScheduleAtChange: (value: string) => void;
  onSave: () => void;
  /** `publishAt` is an ISO datetime, or null to publish now. */
  onPublish: (publishAt: string | null) => void;
  revisionsHref: string;
}

function SaveIndicator({
  dirty,
  saving,
  lastSavedAt,
  saveError,
}: Pick<PublishBarProps, "dirty" | "saving" | "lastSavedAt" | "saveError">) {
  if (saveError) {
    return (
      <span role="alert" className="text-xs text-[var(--color-danger)]">
        Not saved: {saveError}
      </span>
    );
  }

  if (saving) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <Spinner size="sm" />
        Saving…
      </span>
    );
  }

  if (dirty) {
    return <Badge variant="warning">Unsaved changes</Badge>;
  }

  if (lastSavedAt) {
    return (
      <span className="text-xs text-[var(--color-ink-muted)]">
        Saved{" "}
        <time dateTime={lastSavedAt.toISOString()}>
          {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </span>
    );
  }

  return <span className="text-xs text-[var(--color-ink-muted)]">No changes</span>;
}

export function PublishBar({
  status,
  canPublish,
  dirty,
  saving,
  publishing,
  lastSavedAt,
  saveError,
  scheduleAt,
  onScheduleAtChange,
  onSave,
  onPublish,
  revisionsHref,
}: PublishBarProps) {
  const scheduled = scheduleAt.trim().length > 0;
  const busy = saving || publishing;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={status} />
      <SaveIndicator
        dirty={dirty}
        saving={saving}
        lastSavedAt={lastSavedAt}
        saveError={saveError}
      />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={revisionsHref}>
            <HistoryIcon aria-hidden="true" />
            Revisions
          </Link>
        </Button>

        <Button variant="outline" onClick={onSave} disabled={busy || !dirty}>
          <SaveIcon aria-hidden="true" />
          Save
        </Button>

        {canPublish ? (
          <>
            <Input
              type="datetime-local"
              value={scheduleAt}
              onChange={(event) => onScheduleAtChange(event.target.value)}
              aria-label="Publish at (leave empty to publish now)"
              title="Leave empty to publish now"
              className="h-8 w-52"
            />
            <Button
              onClick={() =>
                // `datetime-local` is naive local time; the capability wants an
                // instant, so it is resolved against this browser's zone here.
                onPublish(scheduled ? new Date(scheduleAt).toISOString() : null)
              }
              disabled={busy}
            >
              {publishing ? (
                <Spinner size="sm" />
              ) : scheduled ? (
                <ClockIcon aria-hidden="true" />
              ) : (
                <SendIcon aria-hidden="true" />
              )}
              {scheduled ? "Schedule" : "Publish"}
            </Button>
          </>
        ) : (
          <span className="text-xs text-[var(--color-ink-muted)]">
            Authors cannot publish. Ask an editor to review this draft.
          </span>
        )}
      </div>

      {canPublish && scheduled && (
        <p className="w-full text-xs text-[var(--color-ink-muted)]">
          Saved first, then scheduled. A time in the past publishes immediately.
        </p>
      )}
    </div>
  );
}
