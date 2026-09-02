"use client";

import { useEffect, useState } from "react";
import { CopyIcon } from "lucide-react";
import { Badge, Button, Field, Input, Label, Switch, cn } from "@cms/ui";
import {
  SERP_DESCRIPTION_FONT,
  SERP_DESCRIPTION_LIMIT_PX,
  SERP_TITLE_FONT,
  SERP_TITLE_LIMIT_PX,
  fitToWidth,
  type FittedText,
} from "./pixel-width";
import type {
  DocumentDraft,
  EditorHeading,
  EditorQaBlock,
  EditorSite,
  LengthRange,
} from "./types";

/**
 * What the document looks like to a search engine, and what it will emit.
 *
 * Everything here is either measured the way the consumer measures it, or
 * shown read-only exactly as it will be written. An author who cannot see the
 * canonical URL the pipeline is going to emit has no way to notice that it is
 * wrong until the page is live.
 */

/** Measured in an effect: there is no canvas on the server to measure with. */
function useFitted(text: string, font: string, limitPx: number): FittedText | null {
  const [fit, setFit] = useState<FittedText | null>(null);
  useEffect(() => {
    setFit(fitToWidth(text, font, limitPx));
  }, [text, font, limitPx]);
  return fit;
}

function CopyAnchor({ anchor }: { anchor: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={copied ? `Copied ${anchor}` : `Copy the anchor ${anchor}`}
      title={`Copy ${anchor}`}
      onClick={() => {
        void navigator.clipboard?.writeText(anchor).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      <CopyIcon aria-hidden="true" className={copied ? "text-[var(--color-ok)]" : undefined} />
    </Button>
  );
}

/**
 * The SERP snippet, truncated by pixel width.
 *
 * Character counts are the wrong unit — see `pixel-width.ts` — so the strings
 * below are cut where a canvas says the rendered text crosses the limit, and
 * the measured width is reported next to the limit so the number is legible
 * rather than a verdict.
 */
function SerpPreview({
  title,
  description,
  canonical,
}: {
  title: string;
  description: string;
  canonical: string;
}) {
  const fittedTitle = useFitted(title, SERP_TITLE_FONT, SERP_TITLE_LIMIT_PX);
  const fittedDescription = useFitted(
    description,
    SERP_DESCRIPTION_FONT,
    SERP_DESCRIPTION_LIMIT_PX,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] p-3">
        <p className="truncate text-xs text-[var(--color-ink-muted)]">{canonical}</p>
        <p className="mt-1 text-base leading-snug text-[var(--color-accent)]">
          {fittedTitle?.shown ?? title ?? ""}
          {title.trim().length === 0 && (
            <span className="text-[var(--color-ink-muted)] italic">Untitled</span>
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          {description.trim().length === 0 ? (
            <span className="italic">
              No meta description. Search engines will invent one from the body.
            </span>
          ) : (
            (fittedDescription?.shown ?? description)
          )}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <WidthReadout
          label="Title width"
          fit={fittedTitle}
          limit={SERP_TITLE_LIMIT_PX}
          empty={title.trim().length === 0}
        />
        <WidthReadout
          label="Description width"
          fit={fittedDescription}
          limit={SERP_DESCRIPTION_LIMIT_PX}
          empty={description.trim().length === 0}
        />
      </dl>
    </div>
  );
}

function WidthReadout({
  label,
  fit,
  limit,
  empty,
}: {
  label: string;
  fit: FittedText | null;
  limit: number;
  empty: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] px-2 py-1.5">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="mt-0.5 font-[family-name:var(--font-mono)]">
        {empty || fit === null ? (
          <span className="text-[var(--color-ink-muted)]">— / {limit}px</span>
        ) : (
          <span className={fit.truncated ? "text-[var(--color-warn)]" : undefined}>
            {Math.round(fit.width)} / {limit}px{fit.truncated ? " — cut off" : ""}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Meta description length as a meter.
 *
 * A bare number tells an author nothing about which direction to move in. The
 * bar shows where they are inside the range the `meta-description-length` lint
 * uses, and the wording says which side of it they are on. It is a warning,
 * never a gate, and the copy does not pretend otherwise.
 */
function DescriptionMeter({ value, range }: { value: string; range: LengthRange }) {
  const length = value.length;
  const state =
    length === 0
      ? "empty"
      : length < range.min
        ? "short"
        : length > range.max
          ? "long"
          : "good";

  const message = {
    empty: "No description yet.",
    short: `${range.min - length} characters short of the ${range.min}–${range.max} range.`,
    long: `${length - range.max} characters over the ${range.min}–${range.max} range.`,
    good: `Within the ${range.min}–${range.max} range.`,
  }[state];

  const tone = {
    empty: "bg-[var(--color-border)]",
    short: "bg-[var(--color-warn)]",
    long: "bg-[var(--color-warn)]",
    good: "bg-[var(--color-ok)]",
  }[state];

  // Scaled against a little past the maximum so an over-long description still
  // has somewhere to go and does not simply peg at full.
  const scale = Math.round(range.max * 1.25);
  const percent = Math.min(100, Math.round((length / scale) * 100));

  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-label="Meta description length"
        aria-valuenow={length}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuetext={`${length} characters. ${message}`}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted)]"
      >
        {/* The target band, so the meter shows where "good" actually is. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 border-x border-[var(--color-border)]"
          style={{
            left: `${(range.min / scale) * 100}%`,
            width: `${((range.max - range.min) / scale) * 100}%`,
          }}
        />
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        {length} characters. {message}
      </p>
    </div>
  );
}

export interface SeoPanelProps {
  site: EditorSite;
  draft: DocumentDraft;
  onChange: (patch: Partial<DocumentDraft>) => void;
  descriptionRange: LengthRange;
  headings: EditorHeading[];
  qaBlocks: EditorQaBlock[];
  className?: string;
}

export function SeoPanel({
  site,
  draft,
  onChange,
  descriptionRange,
  headings,
  qaBlocks,
  className,
}: SeoPanelProps) {
  /**
   * The same expression `publish_document` uses to build the canonical.
   *
   * Shown rather than edited: the URL is a consequence of the site's base URL,
   * its blog path and this document's slug, and an author who can see it can
   * notice a wrong slug before it is the live address.
   */
  const computedCanonical = `${site.baseUrl}${site.blogBasePath}/${draft.slug}`;
  const override = draft.canonicalUrlOverride.trim();
  const effectiveCanonical = override.length > 0 ? override : computedCanonical;

  return (
    <aside
      aria-label="SEO"
      className={cn(
        "ui-scroll flex flex-col gap-5 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Search result</h2>
        <SerpPreview
          title={draft.title}
          description={draft.description}
          canonical={effectiveCanonical}
        />
      </section>

      <section className="flex flex-col gap-2">
        <Field
          label="Meta description"
          description="Answers the question the title asks. Not the same job as an excerpt."
        >
          {({ id, "aria-describedby": describedBy }) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              value={draft.description}
              onChange={(event) => onChange({ description: event.target.value })}
              rows={3}
              className="ui-focus-ring ui-scroll w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-ink)]"
            />
          )}
        </Field>
        <DescriptionMeter value={draft.description} range={descriptionRange} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Canonical URL</h2>
        <Field
          label="Will be emitted as"
          description="Computed from the site's base URL, its blog path and this slug."
        >
          {({ id, "aria-describedby": describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              readOnly
              value={computedCanonical}
              className="font-[family-name:var(--font-mono)] text-xs"
            />
          )}
        </Field>

        <Field
          label="Canonical override"
          description="For syndicated or republished content that canonicalises somewhere else. Leave empty otherwise."
        >
          {({ id, "aria-describedby": describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="url"
              inputMode="url"
              placeholder="https://original.example.com/article"
              value={draft.canonicalUrlOverride}
              onChange={(event) => onChange({ canonicalUrlOverride: event.target.value })}
              className="font-[family-name:var(--font-mono)] text-xs"
            />
          )}
        </Field>
        {override.length > 0 && (
          <p className="text-xs text-[var(--color-ink-muted)]">
            The override wins: this document will point search engines at{" "}
            <span className="font-[family-name:var(--font-mono)]">{override}</span>.
          </p>
        )}
      </section>

      <section className="flex items-start gap-3">
        <Switch
          id="seo-noindex"
          checked={draft.noindex}
          onCheckedChange={(checked) => onChange({ noindex: checked })}
        />
        <div className="min-w-0">
          <Label htmlFor="seo-noindex">Ask search engines not to index this</Label>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            The page still publishes and still resolves. It is left out of the index only.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Outline</h2>
          <Badge variant="outline">{headings.length}</Badge>
        </div>
        <p className="text-xs text-[var(--color-ink-muted)]">
          These anchor ids are the stable citation targets. They survive a heading being
          reworded, so anything already linking to one keeps resolving.
        </p>

        {headings.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            No headings yet. A post with no headings has nothing for an answer engine to cite.
          </p>
        ) : (
          <ul className="flex flex-col">
            {headings.map((heading) => (
              <li
                key={heading.id}
                className="flex items-start gap-1 border-b border-[var(--color-border)] py-1.5 last:border-b-0"
                style={{ paddingLeft: `${Math.max(0, heading.depth - 2) * 0.75}rem` }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-[var(--color-ink)]" title={heading.text}>
                    <span className="text-[var(--color-ink-muted)]">h{heading.depth}</span>{" "}
                    {heading.text}
                  </p>
                  <p className="truncate font-[family-name:var(--font-mono)] text-[0.6875rem] text-[var(--color-ink-muted)]">
                    #{heading.id}
                  </p>
                  {heading.aliases.length > 0 && (
                    <p className="truncate text-[0.6875rem] text-[var(--color-ink-muted)]">
                      also resolves: {heading.aliases.map((alias) => `#${alias}`).join(", ")}
                    </p>
                  )}
                </div>
                <CopyAnchor anchor={`#${heading.id}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">FAQ</h2>
          <Badge variant="outline">{qaBlocks.length}</Badge>
        </div>
        {qaBlocks.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            No <span className="font-[family-name:var(--font-mono)]">:::faq</span> blocks in this
            document.
          </p>
        ) : (
          <ul className="flex flex-col">
            {qaBlocks.map((block) => (
              <li
                key={block.anchorId}
                className="flex items-start gap-1 border-b border-[var(--color-border)] py-1.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--color-ink)]">{block.question}</p>
                  <p className="truncate font-[family-name:var(--font-mono)] text-[0.6875rem] text-[var(--color-ink-muted)]">
                    #{block.anchorId}
                  </p>
                </div>
                <CopyAnchor anchor={`#${block.anchorId}`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
