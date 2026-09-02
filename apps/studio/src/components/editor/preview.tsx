"use client";

import { useEffect, useState } from "react";
import { EyeIcon } from "lucide-react";
import { Badge, Spinner, cn } from "@cms/ui";
import { renderPreviewAction } from "./actions";
import type { PreviewPayload } from "./types";

/**
 * The live preview, rendered by the pipeline that publishes.
 *
 * Nothing here parses markdown. The markdown goes to the server, through the
 * `render_preview` capability, which calls the same `renderForSite` that
 * `publish_document` calls — same directives, same anchor reconciliation, same
 * media resolution, same sanitiser. A client-side markdown renderer would be a
 * second pipeline, and a second pipeline diverges: the preview starts showing
 * a heading id, an FAQ block or an embed that the published page will not
 * have, and the author only finds out after it ships. The round trip is the
 * price of the guarantee, and it is why the call is debounced rather than
 * replaced by something local.
 */

/**
 * Long enough that a burst of typing is one request, short enough that the
 * preview feels attached to the keyboard.
 */
const DEBOUNCE_MS = 350;

export interface PreviewState {
  payload: PreviewPayload | null;
  /** A render is queued or in flight. */
  pending: boolean;
  error: string | null;
  /** True once at least one render has come back, successfully or not. */
  checked: boolean;
}

export interface UsePreviewInput {
  siteSlug: string;
  documentId: string;
  slug: string;
  markdown: string;
}

/**
 * One response feeds every panel on the screen.
 *
 * The preview pane, the checks list, the outline and the FAQ list are all
 * views onto a single `render_preview` result, so they cannot disagree with
 * each other about what the document currently is. That is the reason this
 * hook lives beside the preview and is lifted into the screen, rather than
 * each panel fetching for itself.
 */
export function usePreview({
  siteSlug,
  documentId,
  slug,
  markdown,
}: UsePreviewInput): PreviewState {
  const [state, setState] = useState<PreviewState>({
    payload: null,
    pending: true,
    error: null,
    checked: false,
  });

  useEffect(() => {
    let live = true;
    // Returning the same object when nothing changes keeps a keystroke from
    // costing a render that paints an identical screen.
    setState((previous) => (previous.pending ? previous : { ...previous, pending: true }));

    const timer = setTimeout(() => {
      void renderPreviewAction({ siteSlug, documentId, slug, markdown }).then(
        (result) => {
          // The cleanup below flips this before the next edit's request goes
          // out, so a slow response for text the author has already replaced
          // is dropped rather than painted over the newer one.
          if (!live) return;
          setState(
            result.ok
              ? { payload: result.data, pending: false, error: null, checked: true }
              : {
                  payload: null,
                  pending: false,
                  error: result.message,
                  checked: true,
                },
          );
        },
        (error: unknown) => {
          if (!live) return;
          setState({
            payload: null,
            pending: false,
            error:
              error instanceof Error
                ? error.message
                : "The preview could not be rendered. Check your connection and keep writing — nothing has been lost.",
            checked: true,
          });
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [siteSlug, documentId, slug, markdown]);

  return state;
}

/**
 * Styling for the pipeline's own markup.
 *
 * The class names are the pipeline's contract — `cms-tldr`, `cms-faq`,
 * `cms-howto` and the rest are what the consuming site's stylesheet and the
 * Speakable JSON-LD select on — so this only paints them. It never rewrites
 * them.
 */
const PROSE = cn(
  "text-sm leading-relaxed text-[var(--color-ink)]",
  "[&_p]:my-3",
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold",
  "[&_a]:text-[var(--color-accent)] [&_a]:underline [&_a]:underline-offset-2",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1",
  "[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-md",
  "[&_figcaption]:mt-1 [&_figcaption]:text-xs [&_figcaption]:text-[var(--color-ink-muted)]",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--color-ink-muted)]",
  "[&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-[family-name:var(--font-mono)] [&_code]:text-[0.8125em]",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-left",
  "[&_th]:border-b [&_th]:border-[var(--color-border)] [&_th]:py-1 [&_th]:font-semibold",
  "[&_td]:border-b [&_td]:border-[var(--color-border)] [&_td]:py-1",
  "[&_hr]:my-6 [&_hr]:border-[var(--color-border)]",
  // The authoring blocks.
  "[&_.cms-tldr]:my-4 [&_.cms-tldr]:rounded-md [&_.cms-tldr]:border-l-2 [&_.cms-tldr]:border-[var(--color-accent)] [&_.cms-tldr]:bg-[var(--color-muted)] [&_.cms-tldr]:px-3 [&_.cms-tldr]:py-2",
  "[&_.cms-takeaways]:my-4 [&_.cms-takeaways]:rounded-md [&_.cms-takeaways]:border [&_.cms-takeaways]:border-[var(--color-border)] [&_.cms-takeaways]:py-2 [&_.cms-takeaways]:pr-3 [&_.cms-takeaways]:pl-8",
  "[&_.cms-faq]:my-4 [&_.cms-faq]:rounded-md [&_.cms-faq]:border [&_.cms-faq]:border-[var(--color-border)] [&_.cms-faq]:px-3 [&_.cms-faq]:py-1",
  "[&_.cms-faq\\_\\_question]:mt-3 [&_.cms-faq\\_\\_question]:text-sm [&_.cms-faq\\_\\_question]:font-semibold",
  "[&_.cms-howto]:my-4 [&_.cms-howto]:rounded-md [&_.cms-howto]:border [&_.cms-howto]:border-[var(--color-border)] [&_.cms-howto]:px-3 [&_.cms-howto]:py-1",
  "[&_.cms-embed]:my-4 [&_.cms-embed]:overflow-hidden [&_.cms-embed]:rounded-md [&_.cms-embed]:border [&_.cms-embed]:border-[var(--color-border)]",
);

export interface PreviewProps {
  state: PreviewState;
  className?: string;
}

export function Preview({ state, className }: PreviewProps) {
  const { payload, pending, error } = state;

  return (
    <section
      aria-label="Preview"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <EyeIcon className="size-4 text-[var(--color-ink-muted)]" aria-hidden="true" />
        <h2 className="text-sm font-medium">Preview</h2>
        <span className="text-xs text-[var(--color-ink-muted)]">
          rendered by the publishing pipeline
        </span>

        <div className="ml-auto flex items-center gap-2">
          {payload && (
            <Badge variant="outline">
              {payload.wordCount.toLocaleString()} words &middot; {payload.readingTimeMinutes} min
            </Badge>
          )}
          {pending && <Spinner size="sm" label="Rendering preview" />}
        </div>
      </header>

      <div className="ui-scroll min-h-0 flex-1 overflow-auto px-4 py-2">
        {error ? (
          <p role="alert" className="py-6 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : payload === null ? (
          <p className="py-6 text-sm text-[var(--color-ink-muted)]">Rendering…</p>
        ) : payload.html.trim().length === 0 ? (
          <p className="py-6 text-sm text-[var(--color-ink-muted)]">
            Nothing to preview yet. Start writing on the left.
          </p>
        ) : (
          /*
           * The HTML is sanitised on the server by `rehype-sanitize`, against
           * the schema in `packages/content/src/sanitize-schema.ts`, before it
           * is ever stored or sent anywhere. Do not sanitise it again here:
           * a second pass with a general-purpose client-side sanitiser would
           * strip the `cms-*` classes and the `data-cms-qa` markers the
           * pipeline deliberately emits, and the preview would stop matching
           * the page that ships — which is the one thing this pane exists to
           * guarantee.
           */
          <div className={PROSE} dangerouslySetInnerHTML={{ __html: payload.html }} />
        )}
      </div>
    </section>
  );
}
