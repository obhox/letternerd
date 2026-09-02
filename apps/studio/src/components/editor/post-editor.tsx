"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Input, type DocumentStatus } from "@cms/ui";
import { publishDocumentAction, saveDocumentAction } from "./actions";
import { FindingList, LintPanel } from "./lint-panel";
import { MarkdownEditor } from "./markdown-editor";
import { Preview, usePreview } from "./preview";
import { PublishBar } from "./publish-bar";
import { SeoPanel } from "./seo-panel";
import type {
  DocumentDraft,
  EditorDocument,
  EditorFinding,
  EditorSite,
  LengthRange,
} from "./types";

/**
 * The editor screen.
 *
 * It holds the draft, decides when to save it, and hands one `render_preview`
 * response to every panel that needs one. It holds no rule about who may
 * publish or what counts as blocking — those come back from the capability
 * layer, which is the only place they are defined.
 */

/** Long enough that a paragraph is one save rather than forty. */
const AUTOSAVE_MS = 1500;

function toDraft(post: EditorDocument): DocumentDraft {
  return {
    slug: post.slug,
    title: post.title,
    description: post.description ?? "",
    bodyMd: post.bodyMd,
    noindex: post.noindex,
    canonicalUrlOverride: post.canonicalUrlOverride ?? "",
  };
}

function sameDraft(a: DocumentDraft, b: DocumentDraft): boolean {
  return (
    a.slug === b.slug &&
    a.title === b.title &&
    a.description === b.description &&
    a.bodyMd === b.bodyMd &&
    a.noindex === b.noindex &&
    a.canonicalUrlOverride === b.canonicalUrlOverride
  );
}

export interface PostEditorProps {
  site: EditorSite;
  post: EditorDocument;
  /** From `can.publish(role)`, decided on the server. Presentation only — the
   *  capability refuses regardless of what this component renders. */
  canPublish: boolean;
  /** The `meta-description-length` lint's own bounds, passed in so this screen
   *  does not restate them. */
  descriptionRange: LengthRange;
}

export function PostEditor({ site, post, canPublish, descriptionRange }: PostEditorProps) {
  const initial = toDraft(post);

  const [draft, setDraftState] = useState<DocumentDraft>(initial);
  const [saved, setSavedState] = useState<DocumentDraft>(initial);
  const [status, setStatus] = useState<DocumentStatus>(post.status);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ message: string; findings: EditorFinding[] } | null>(
    null,
  );
  const [scheduleAt, setScheduleAt] = useState("");

  /**
   * Mirrors of the three values the async paths read.
   *
   * A save started by a timer runs long after the render that scheduled it, so
   * reading `draft` from that closure would persist whatever the post
   * looked like a second and a half ago and silently discard the keystrokes
   * since.
   */
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  const savingRef = useRef(false);
  const publishingRef = useRef(false);

  const dirty = !sameDraft(draft, saved);

  const patch = useCallback((changes: Partial<DocumentDraft>) => {
    setDraftState((previous) => {
      const next = { ...previous, ...changes };
      draftRef.current = next;
      return next;
    });
  }, []);

  /**
   * Persist, and report whether it worked.
   *
   * Refuses while a publish is in flight. Publishing renders and stores in one
   * transaction, and a save landing in the middle of that would write over the
   * rendered output with an unrendered body.
   */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (publishingRef.current || savingRef.current) return false;

    const snapshot = draftRef.current;
    if (sameDraft(snapshot, savedRef.current)) return true;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);

    try {
      const result = await saveDocumentAction({
        siteSlug: site.slug,
        documentId: post.id,
        draft: snapshot,
      });

      if (!result.ok) {
        setSaveError(result.message);
        return false;
      }

      // The snapshot that was sent, not the current draft: anything typed
      // during the round trip is still unsaved and must stay marked as such.
      savedRef.current = snapshot;
      setSavedState(snapshot);
      setLastSavedAt(new Date());
      return true;
    } catch {
      setSaveError("The save could not be sent. Check your connection and try again.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [site.slug, post.id]);

  // Autosave. The timer is reset by every edit, so it fires once a burst of
  // typing stops rather than once per keystroke.
  useEffect(() => {
    if (!dirty || publishing) return;
    const timer = setTimeout(() => {
      void saveNow();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, draft, publishing, saveNow]);

  // Ctrl/Cmd-S anywhere on the screen, not only inside the editor.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow]);

  // Autosave covers most exits, but a close within the debounce window would
  // still lose the last edit, so the browser asks.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function publish(publishAt: string | null): Promise<void> {
    if (publishingRef.current || savingRef.current) return;

    setBlocked(null);
    setPublishError(null);
    setPublishNotice(null);

    // `publish_document` renders what is stored, not what is on screen. An
    // unsaved draft would publish the previous text and report success.
    const persisted = await saveNow();
    if (!persisted) {
      setPublishError(
        "Nothing was published, because the post could not be saved first. Fix the save error and try again.",
      );
      return;
    }

    publishingRef.current = true;
    setPublishing(true);

    try {
      const result = await publishDocumentAction({
        siteSlug: site.slug,
        documentId: post.id,
        publishAt,
      });

      if (result.ok) {
        setStatus(result.data.status);
        setPublishNotice(
          result.data.status === "scheduled" && result.data.scheduledFor
            ? `Scheduled for ${new Date(result.data.scheduledFor).toLocaleString()}.`
            : "Published.",
        );
        setScheduleAt("");
        return;
      }

      if (result.code === "precondition_failed") {
        /*
         * Not an error, and not worded as one. The lint gate has refused to
         * ship something that is actually broken, which is the gate doing its
         * job. The author stays exactly where they are, with the findings in
         * front of them and every keystroke intact.
         */
        setBlocked({ message: result.message, findings: result.findings });
        return;
      }

      setPublishError(result.message);
    } catch {
      setPublishError("The publish request could not be sent. Check your connection and try again.");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  const preview = usePreview({
    siteSlug: site.slug,
    documentId: post.id,
    slug: draft.slug,
    markdown: draft.bodyMd,
  });

  const findings = preview.payload?.lints ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">
        Editing {draft.title.trim().length > 0 ? draft.title : "an untitled post"}
      </h1>

      <header className="flex flex-col gap-2">
        <Input
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          aria-label="Title"
          placeholder="Untitled post"
          className="h-9 text-base font-semibold"
        />

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <label htmlFor="post-slug" className="shrink-0">
            <span className="font-[family-name:var(--font-mono)]">
              {site.baseUrl}
              {site.blogBasePath}/
            </span>
          </label>
          <Input
            id="post-slug"
            value={draft.slug}
            onChange={(event) => patch({ slug: event.target.value })}
            placeholder="lowercase-kebab-case"
            className="h-7 w-64 font-[family-name:var(--font-mono)] text-xs"
          />
          {status === "published" && draft.slug !== saved.slug && (
            <span className="text-[var(--color-warn)]">
              Renaming a published post records a 301 from the old URL automatically.
            </span>
          )}
        </div>

        <PublishBar
          status={status}
          canPublish={canPublish}
          dirty={dirty}
          saving={saving}
          publishing={publishing}
          lastSavedAt={lastSavedAt}
          saveError={saveError}
          scheduleAt={scheduleAt}
          onScheduleAtChange={setScheduleAt}
          onSave={() => void saveNow()}
          onPublish={(publishAt) => void publish(publishAt)}
          revisionsHref={`/${site.slug}/posts/${post.id}/revisions`}
        />
      </header>

      {blocked && (
        <section
          // `alert` rather than `status`: the author pressed publish and needs
          // to know immediately that it did not happen.
          role="alert"
          aria-labelledby="publish-blocked-heading"
          className="rounded-lg border-2 border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_8%,var(--color-surface))] p-4"
        >
          <h2
            id="publish-blocked-heading"
            className="flex items-center gap-2 text-sm font-semibold text-[var(--color-danger)]"
          >
            <CircleAlertIcon className="size-4" aria-hidden="true" />
            Publishing was refused
          </h2>
          <p className="mt-1 mb-3 text-sm text-[var(--color-ink)]">
            {blocked.message} Nothing was published and nothing was lost. Fix the problems below
            and press publish again.
          </p>
          <FindingList findings={blocked.findings} />
        </section>
      )}

      {publishError && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {publishError}
        </p>
      )}

      {publishNotice && (
        <p role="status" className="text-sm text-[var(--color-ok)]">
          {publishNotice}
        </p>
      )}

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <MarkdownEditor
          initialValue={post.bodyMd}
          onChange={(bodyMd) => patch({ bodyMd })}
          onSaveRequest={() => void saveNow()}
          className="h-[32rem] xl:h-[calc(100vh-18rem)]"
        />

        <div className="flex min-h-0 flex-col gap-4">
          <Preview state={preview} className="h-[24rem] xl:h-[calc(100vh-32rem)]" />
          <LintPanel findings={findings} checked={preview.checked} pending={preview.pending} />
        </div>

        <SeoPanel
          site={site}
          draft={draft}
          onChange={patch}
          descriptionRange={descriptionRange}
          headings={preview.payload?.headings ?? []}
          qaBlocks={preview.payload?.qaBlocks ?? []}
          className="max-h-[calc(100vh-18rem)]"
        />
      </div>
    </div>
  );
}
