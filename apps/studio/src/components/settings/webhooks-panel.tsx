"use client";

import { useState, useTransition } from "react";
import { WebhookIcon } from "lucide-react";
import { Badge, Button, Checkbox, EmptyState, Field, Input, Label } from "@cms/ui";
import {
  deleteWebhookAction,
  upsertWebhookAction,
} from "@/app/(studio)/[site]/settings/actions";
import { CopyOnceSecret } from "./copy-once";
import type { WebhookView } from "./types";

/**
 * Outbound hooks, and their signing secrets.
 *
 * The secret is what the receiving site verifies an HMAC with, so it is a
 * credential in exactly the way an API key is: shown once at creation, never
 * listed, and rotating it breaks every receiver still holding the old one —
 * which the rotation control says out loud, because that breakage is silent
 * otherwise. Deliveries simply start failing verification on a machine nobody
 * is watching.
 */
export function WebhooksPanel({
  siteSlug,
  webhooks,
  knownEvents,
}: {
  siteSlug: string;
  webhooks: WebhookView[];
  knownEvents: string[];
}) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([...knownEvents]);
  const [secret, setSecret] = useState<{ value: string; notice: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(event: string, on: boolean) {
    setEvents((previous) =>
      on ? [...new Set([...previous, event])] : previous.filter((item) => item !== event),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {secret && (
        <CopyOnceSecret
          label={`Signing secret for ${secret.url}`}
          value={secret.value}
          notice={secret.notice}
          onDismiss={() => setSecret(null)}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Add a webhook</h2>
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await upsertWebhookAction(siteSlug, { url, events });
              if (!result.ok || !result.data) {
                setError(result.message ?? "Could not save that webhook.");
                return;
              }
              if (result.data.secret) {
                setSecret({
                  value: result.data.secret,
                  notice: result.data.notice ?? "This secret is not shown again.",
                  url: result.data.webhook.url,
                });
              }
              setUrl("");
            });
          }}
        >
          <Field
            label="Endpoint URL"
            description="Must be https."
          >
            {({ id, ...wiring }) => (
              <Input
                id={id}
                {...wiring}
                type="url"
                value={url}
                onChange={(changeEvent) => setUrl(changeEvent.target.value)}
                placeholder="https://example.com/api/revalidate"
                required
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-sm font-medium text-[var(--color-ink)]">Events</legend>
            {knownEvents.map((event) => (
              <div key={event} className="flex items-center gap-2">
                <Checkbox
                  id={`event-${event}`}
                  checked={events.includes(event)}
                  onCheckedChange={(checked) => toggle(event, checked === true)}
                />
                <Label htmlFor={`event-${event}`} className="font-mono text-xs">
                  {event}
                </Label>
              </div>
            ))}
          </fieldset>

          <Button type="submit" disabled={pending || url.trim() === "" || events.length === 0}>
            {pending ? "Saving…" : "Add webhook"}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Webhooks</h2>

        {webhooks.length === 0 ? (
          <EmptyState
            icon={WebhookIcon}
            title="No webhooks"
            description="Lets the consuming site revalidate a page the moment it is published."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            {webhooks.map((webhook) => (
              <li key={webhook.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <code className="block truncate font-mono text-xs text-[var(--color-ink)]">
                    {webhook.url}
                  </code>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {webhook.events.map((event) => (
                      <Badge key={event} variant="outline">
                        {event}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Badge variant={webhook.isActive ? "success" : "default"}>
                  {webhook.isActive ? "Active" : "Paused"}
                </Badge>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Rotate this webhook's signing secret? Deliveries stop verifying on the receiving site until it is updated with the new secret.",
                      )
                    ) {
                      return;
                    }
                    startTransition(async () => {
                      const result = await upsertWebhookAction(siteSlug, {
                        id: webhook.id,
                        url: webhook.url,
                        events: webhook.events,
                        isActive: webhook.isActive,
                        rotateSecret: true,
                      });
                      if (!result.ok || !result.data?.secret) {
                        setError(result.message ?? "Could not rotate that secret.");
                        return;
                      }
                      setSecret({
                        value: result.data.secret,
                        notice: result.data.notice ?? "This secret is not shown again.",
                        url: webhook.url,
                      });
                    });
                  }}
                >
                  Rotate secret
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await upsertWebhookAction(siteSlug, {
                        id: webhook.id,
                        url: webhook.url,
                        events: webhook.events,
                        isActive: !webhook.isActive,
                      });
                      if (!result.ok) setError(result.message ?? "Could not update that webhook.");
                    });
                  }}
                >
                  {webhook.isActive ? "Pause" : "Resume"}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Delete the webhook for ${webhook.url}?`)) return;
                    startTransition(async () => {
                      const result = await deleteWebhookAction(siteSlug, webhook.id);
                      if (!result.ok) setError(result.message ?? "Could not delete that webhook.");
                    });
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
