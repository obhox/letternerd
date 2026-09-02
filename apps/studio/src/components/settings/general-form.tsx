"use client";

import { useState, useTransition } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button, Field, Input } from "@cms/ui";
import { updateSiteAction } from "@/app/(studio)/[site]/settings/actions";
import type { SiteSettingsView } from "./types";

/**
 * Site identity and addressing.
 *
 * `baseUrl` is the field this screen is really about. It is the origin of the
 * site that renders this content, and every absolute URL the CMS emits —
 * canonical tags, sitemap entries, feed links, OG image references — is built
 * from it. Changing it therefore rewrites the canonical identity of every
 * published document at once, which is not something to discover after the
 * fact, so the warning appears the moment the value is edited rather than in a
 * confirmation dialog nobody reads.
 */
export function GeneralForm({ siteSlug, site }: { siteSlug: string; site: SiteSettingsView }) {
  const [form, setForm] = useState({
    name: site.name,
    baseUrl: site.baseUrl,
    blogBasePath: site.blogBasePath,
    locale: site.locale,
  });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const baseUrlChanged = form.baseUrl.replace(/\/+$/, "") !== site.baseUrl.replace(/\/+$/, "");

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
          const result = await updateSiteAction(siteSlug, form);
          setMessage(
            result.ok
              ? { tone: "ok", text: "Saved." }
              : { tone: "error", text: result.message ?? "Could not save these settings." },
          );
        });
      }}
    >
      <Field label="Site name" description="Shown in the studio and used as the feed title fallback.">
        {({ id, ...wiring }) => (
          <Input
            id={id}
            {...wiring}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            required
          />
        )}
      </Field>

      <Field
        label="Base URL"
        description="The origin of the site that renders this content — not this studio's address. Every canonical URL, sitemap entry and feed link is built from it."
      >
        {({ id, ...wiring }) => (
          <Input
            id={id}
            {...wiring}
            type="url"
            inputMode="url"
            value={form.baseUrl}
            onChange={(event) => set("baseUrl", event.target.value)}
            required
          />
        )}
      </Field>

      {baseUrlChanged && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-[var(--color-warn)] bg-[color-mix(in_oklch,var(--color-warn)_10%,var(--color-surface))] p-3 text-sm text-[var(--color-ink)]"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
          <span>
            Saving this rewrites the canonical URL of every published document on this site, along
            with every sitemap entry, feed link and Open Graph image reference. Search engines will
            re-evaluate the whole site. Change it only when the site has genuinely moved, and add
            redirects from the old origin.
          </span>
        </p>
      )}

      <Field
        label="Blog base path"
        description="Where posts live on the consuming site, e.g. /blog. Post URLs are this path plus the slug."
      >
        {({ id, ...wiring }) => (
          <Input
            id={id}
            {...wiring}
            value={form.blogBasePath}
            onChange={(event) => set("blogBasePath", event.target.value)}
            required
          />
        )}
      </Field>

      <Field
        label="Locale"
        description="BCP-47, e.g. en or en-GB. Drives og:locale, inLanguage and hreflang."
      >
        {({ id, ...wiring }) => (
          <Input
            id={id}
            {...wiring}
            value={form.locale}
            onChange={(event) => set("locale", event.target.value)}
            required
          />
        )}
      </Field>

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
