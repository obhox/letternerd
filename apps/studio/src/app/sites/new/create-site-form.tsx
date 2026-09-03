"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Card, CardContent, Field, Input, PageHeader } from "@cms/ui";
import { createSiteAction, INITIAL_CREATE_SITE_STATE } from "./actions";

/**
 * A site's `baseUrl` is the origin content actually renders on, not the
 * studio's own hostname — see `packages/db/src/schema/tenancy.ts`. The form
 * only asks for it and a name; the slug used in studio URLs is derived from
 * the name automatically (`packages/auth/src/sites.ts`) rather than asked for,
 * since it is not something anyone visiting the consuming site ever sees.
 */
export function CreateSiteForm() {
  const [state, formAction, pending] = useActionState(createSiteAction, INITIAL_CREATE_SITE_STATE);

  return (
    <div>
      <PageHeader title="Add a site" description="You will be its owner." />

      <Card>
        <CardContent className="pt-6">
          <form action={formAction} className="flex flex-col gap-4">
            <Field label="Site name" description="How you'll recognise it in the studio.">
              {({ id, ...wiring }) => (
                <Input id={id} {...wiring} name="name" required maxLength={200} autoFocus />
              )}
            </Field>

            <Field
              label="Base URL"
              description="The origin the content will actually render on, e.g. https://example.com. Every canonical link the studio emits is built from this."
            >
              {({ id, ...wiring }) => (
                <Input
                  id={id}
                  {...wiring}
                  name="baseUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com"
                  required
                />
              )}
            </Field>

            {state.error ? (
              <p
                role="alert"
                className="rounded-md border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--color-surface))] p-3 text-sm text-[var(--color-ink)]"
              >
                {state.error}
              </p>
            ) : null}

            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create site"}
            </Button>

            <p className="text-center text-sm text-[var(--color-ink-muted)]">
              <Link href="/" className="underline underline-offset-2">
                Back to your sites
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
