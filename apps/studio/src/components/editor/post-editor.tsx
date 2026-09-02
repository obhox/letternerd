"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlertIcon,
  ColumnsIcon,
  EyeIcon,
  PanelRightIcon,
  PenLineIcon,
} from "lucide-react";
import { Button, Input, cn, type DocumentStatus } from "@cms/ui";
import { publishDocumentAction, saveDocumentAction } from "./actions";
import { scanHeadings } from "./document-scan";
import { FindingList, LintPanel } from "./lint-panel";
import { MarkdownEditor, type EditorApi } from "./markdown-editor";
import { OutlinePanel } from "./outline";
import { useRemembered, useRememberedFlag } from "./preferences";
import { Preview, usePreview } from "./preview";
import { PublishBar } from "./publish-bar";
import { useScrollSync } from "./scroll-sync";
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

/**
 * Write, split, or read.
 *
 * Three modes rather than a draggable splitter, because the useful states are
 * discrete: composing (nothing but the text), checking (both), and reading
 * what a visitor will get (nothing but the render). The choice is remembered,
 * since it is a working habit rather than a per-document decision.
 */
const VIEW_MODES = ["write", "split", "preview"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const MODE_BUTTONS: { mode: ViewMode; label: string; hint: string; icon: typeof EyeIcon }[] = [
  { mode: "write", label: "Write", hint: "The editor alone, centred", icon: PenLineIcon },
  { mode: "split", label: "Split", hint: "Editor and preview, scrolling together", icon: ColumnsIcon },
  { mode: "preview", label: "Preview", hint: "The rendered page alone", icon: EyeIcon },
];

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
   * The markdown as of the last publish, when it can be known.
   *
   * `hasUnpublishedChanges` is accurate at page load and stale a keystroke
   * later, so it is not read directly. If the server says nothing is
   * unpublished then the loaded body *is* the published body; if it says
   * something is, we do not know what was published, only that it was
   * something else — which `null` records honestly, and a publish resolves.
   */
  const [publishedBody, setPublishedBody] = useState<string | null>(
    post.hasUnpublishedChanges ? null : post.bodyMd,
  );

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
        // Publishing rendered exactly the body that was saved a moment ago,
        // so that is now the version readers see.
        setPublishedBody(savedRef.current.bodyMd);
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

  /**
   * Which panes are showing, remembered across sessions.
   *
   * Split is the default because it is the mode that makes the guarantee
   * visible: what is on the right is what `publish_document` will produce.
   */
  const [mode, setMode] = useRemembered<ViewMode>("view-mode", VIEW_MODES, "split");
  const [railOpen, setRailOpen] = useRememberedFlag("inspector", true);

  const editorRef = useRef<EditorApi | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * The source outline: line numbers, which the render cannot supply.
   *
   * Scanned from the markdown rather than parsed — see `document-scan.ts`.
   * It answers "where in the buffer", not "what does this become"; the second
   * question still belongs entirely to `render_preview`.
   */
  const outline = useMemo(() => scanHeadings(draft.bodyMd), [draft.bodyMd]);
  const lineCount = useMemo(() => draft.bodyMd.split("\n").length, [draft.bodyMd]);

  useScrollSync({
    enabled: mode === "split",
    editorRef,
    previewRef: previewScrollRef,
    headings: outline,
    lineCount,
  });

  /**
   * A pane that was `display: none` has no geometry, so CodeMirror's cached
   * measurements are stale the moment it comes back. The editor is hidden
   * rather than unmounted — unmounting would throw away the undo history, the
   * selection and the scroll position every time somebody glanced at the
   * preview — so it is re-measured instead.
   */
  useEffect(() => {
    if (mode !== "preview") editorRef.current?.remeasure();
  }, [mode]);

  /**
   * "Line 42" made actionable, from the checks panel and from the outline.
   *
   * In preview-only mode there is no visible editor to jump to, so the screen
   * switches to split first and moves the caret on the next frame, once the
   * pane has geometry to scroll.
   */
  const goToLine = useCallback(
    (line: number) => {
      if (mode === "preview") {
        setMode("split");
        requestAnimationFrame(() => editorRef.current?.goToLine(line));
        return;
      }
      editorRef.current?.goToLine(line);
    },
    [mode, setMode],
  );

  /**
   * Saved, but not what readers see.
   *
   * Deliberately measured against `saved` rather than `draft`: unsaved edits
   * are a different distance from the reader and have their own indicator.
   * Collapsing the two would hide the one an author cannot otherwise discover,
   * because nothing else on this screen distinguishes a published document
   * from a published document that has been edited since.
   */
  const live = status === "published" || status === "scheduled";
  const savedIsNotLive =
    live && (publishedBody === null || saved.bodyMd !== publishedBody);

  const nothingBlocking = preview.checked && preview.payload?.blocked === false;

  /**
   * Retire the refusal banner once the document stops deserving it.
   *
   * The banner records a publish attempt, but the author fixes the problem
   * while looking at it, and a "publishing was refused" left standing over a
   * document that would now publish fine is a warning people learn to read
   * past. A fresh check reporting nothing blocking is the signal to drop it.
   */
  useEffect(() => {
    if (blocked && nothingBlocking) setBlocked(null);
  }, [blocked, nothingBlocking]);

  const findings = preview.payload?.lints ?? [];

  return (
    <div className="flex flex-col gap-3">
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
          savedIsNotLive={savedIsNotLive}
          renderStale={post.renderStale}
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
            {blocked.message} Nothing was published and nothing was lost.
          </p>
          <FindingList findings={blocked.findings} onGoToLine={goToLine} />
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

      {/* The view controls. Icons carry a text label beside them: with no hue
          available, an icon on its own is the weakest possible signal of which
          of three states is current. */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="What to show"
          className="flex items-center gap-0.5 rounded-md border border-[var(--color-border)] p-0.5"
        >
          {MODE_BUTTONS.map((option) => (
            <Button
              key={option.mode}
              size="sm"
              variant={mode === option.mode ? "secondary" : "ghost"}
              aria-pressed={mode === option.mode}
              title={option.hint}
              onClick={() => setMode(option.mode)}
            >
              <option.icon aria-hidden="true" />
              {option.label}
            </Button>
          ))}
        </div>

        <Button
          size="sm"
          variant={railOpen ? "secondary" : "ghost"}
          aria-pressed={railOpen}
          title="Checks, outline and search metadata"
          onClick={() => setRailOpen(!railOpen)}
        >
          <PanelRightIcon aria-hidden="true" />
          Inspector
        </Button>

        <p className="ml-auto text-2xs text-[var(--color-ink-muted)]">
          The preview is rendered by the pipeline that publishes, so what is on the right is what
          ships.
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-3 xl:h-[calc(100vh-17rem)] xl:min-h-[34rem] xl:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 xl:flex-row">
          {/*
            Hidden, never unmounted.

            `display: none` keeps the CodeMirror view, and with it the undo
            history, the caret and the scroll position, alive across a trip to
            preview-only and back. Unmounting the editor to save a hidden
            subtree would cost the author all three.
          */}
          <MarkdownEditor
            initialValue={post.bodyMd}
            onChange={(bodyMd) => patch({ bodyMd })}
            onSaveRequest={() => void saveNow()}
            siteSlug={site.slug}
            apiRef={editorRef}
            className={cn(
              "h-[32rem] min-w-0 flex-1 xl:h-full",
              mode === "preview" && "hidden",
            )}
          />

          <Preview
            state={preview}
            scrollRef={previewScrollRef}
            className={cn(
              "h-[32rem] min-w-0 flex-1 xl:h-full",
              mode === "write" && "hidden",
            )}
          />
        </div>

        {railOpen && (
          <aside
            aria-label="Inspector"
            className="ui-scroll flex w-full shrink-0 flex-col gap-3 overflow-auto xl:h-full xl:w-80"
          >
            <LintPanel
              findings={findings}
              checked={preview.checked}
              pending={preview.pending}
              onGoToLine={goToLine}
            />

            <OutlinePanel
              source={outline}
              rendered={preview.payload?.headings ?? []}
              onGoToLine={goToLine}
            />

            <SeoPanel
              site={site}
              draft={draft}
              onChange={patch}
              descriptionRange={descriptionRange}
              qaBlocks={preview.payload?.qaBlocks ?? []}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
