"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Textarea } from "@cms/ui";
import { updateSiteAction } from "@/app/(studio)/[site]/settings/actions";
import type { SiteSettingsView } from "./types";

/**
 * The site-wide structured data and crawler files.
 *
 * These are the fields the SDK emits once per page (the Organization node) and
 * the two generated files that talk to crawlers directly. They are grouped away
 * from the General tab because they are set once and rarely revisited, whereas
 * a wrong `baseUrl` next to them would be easy to change by accident.
 */
export function SeoForm({ siteSlug, site }: { siteSlug: string; site: SiteSettingsView }) {
  const [form, setForm] = useState({
    orgName: site.orgName ?? "",
    orgLogoUrl: site.orgLogoUrl ?? "",
    orgSameAs: site.orgSameAs.join("\n"),
    twitterHandle: site.twitterHandle ?? "",
    feedTitle: site.feedTitle ?? "",
    feedDescription: site.feedDescription ?? "",
    robotsExtra: site.robotsExtra ?? "",
    llmsIntro: site.llmsIntro ?? "",
  });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setMessage(null);
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          /**
           * An emptied optional field is sent as `null`, not as `""`.
           *
           * The capability distinguishes them and so does the output: `null`
           * omits the property from the JSON-LD entirely, while an empty string
           * emits `"name": ""`, which is a claim about the organisation rather
           * than the absence of one.
           */
          const blankToNull = (value: string) => (value.trim() === "" ? null : value.trim());

          const result = await updateSiteAction(siteSlug, {
            orgName: blankToNull(form.orgName),
            orgLogoUrl: blankToNull(form.orgLogoUrl),
            orgSameAs: form.orgSameAs
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0),
            twitterHandle: blankToNull(form.twitterHandle),
            feedTitle: blankToNull(form.feedTitle),
            feedDescription: blankToNull(form.feedDescription),
            robotsExtra: blankToNull(form.robotsExtra),
            llmsIntro: blankToNull(form.llmsIntro),
          });

          setMessage(
            result.ok
              ? { tone: "ok", text: "Saved." }
              : { tone: "error", text: result.message ?? "Could not save these settings." },
          );
        });
      }}
    >
      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="pb-2 text-sm font-semibold text-[var(--color-ink)]">
          Organization structured data
        </legend>
        <p className="-mt-2 text-sm text-[var(--color-ink-muted)]">
          Emitted once per page as an <code className="font-mono text-xs">Organization</code> node.
        </p>

        <Field label="Organization name" description="The publisher, not the site title.">
          {({ id, ...wiring }) => (
            <Input id={id} {...wiring} value={form.orgName} onChange={(e) => set("orgName", e.target.value)} />
          )}
        </Field>

        <Field label="Logo URL" description="An absolute URL to a square logo.">
          {({ id, ...wiring }) => (
            <Input
              id={id}
              {...wiring}
              type="url"
              value={form.orgLogoUrl}
              onChange={(e) => set("orgLogoUrl", e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Same-as profiles"
          description="One absolute URL per line — the organisation's own profiles elsewhere."
        >
          {({ id, ...wiring }) => (
            <Textarea
              id={id}
              {...wiring}
              rows={4}
              value={form.orgSameAs}
              onChange={(e) => set("orgSameAs", e.target.value)}
            />
          )}
        </Field>

        <Field label="X / Twitter handle" description="With or without the @. Used for twitter:site.">
          {({ id, ...wiring }) => (
            <Input
              id={id}
              {...wiring}
              value={form.twitterHandle}
              onChange={(e) => set("twitterHandle", e.target.value)}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="pb-2 text-sm font-semibold text-[var(--color-ink)]">Feeds</legend>

        <Field label="Feed title" description="Falls back to the site name when empty.">
          {({ id, ...wiring }) => (
            <Input id={id} {...wiring} value={form.feedTitle} onChange={(e) => set("feedTitle", e.target.value)} />
          )}
        </Field>

        <Field label="Feed description">
          {({ id, ...wiring }) => (
            <Textarea
              id={id}
              {...wiring}
              rows={2}
              value={form.feedDescription}
              onChange={(e) => set("feedDescription", e.target.value)}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="pb-2 text-sm font-semibold text-[var(--color-ink)]">Crawler files</legend>

        <Field
          label="robots.txt additions"
          description="Appended verbatim to the generated robots.txt. Not validated."
        >
          {({ id, ...wiring }) => (
            <Textarea
              id={id}
              {...wiring}
              rows={5}
              className="font-mono text-xs"
              value={form.robotsExtra}
              onChange={(e) => set("robotsExtra", e.target.value)}
            />
          )}
        </Field>

        <Field
          label="llms.txt introduction"
          description="The summary at the head of llms.txt."
        >
          {({ id, ...wiring }) => (
            <Textarea
              id={id}
              {...wiring}
              rows={4}
              value={form.llmsIntro}
              onChange={(e) => set("llmsIntro", e.target.value)}
            />
          )}
        </Field>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error"
                ? "text-sm text-[var(--color-danger)]"
                : "text-sm text-[var(--color-ok)]"
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
