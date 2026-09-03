"use client";

import { useState, useTransition } from "react";
import { ChartNoAxesColumnIcon } from "lucide-react";
import { Badge, Button, EmptyState } from "@cms/ui";
import { disconnectConnectionAction, testConnectionAction } from "./actions";
import type { CallbackNotice, ConnectionView } from "./types";

/**
 * Connection status, the three actions, and an honest account of what is
 * missing.
 *
 * The design decision worth naming: this screen never renders a connection as
 * simply "OK". It renders when it last synced, when its token expires, and what
 * failed last, because a connection that stopped working reports nothing on its
 * own — the insights screen just quietly loses three of its six rules. The only
 * place that silence becomes visible is here.
 */

const PROVIDER_LABELS: Record<string, string> = {
  search_console: "Google Search Console",
  falorb: "Falorb",
};

/**
 * Stated in the words an editor would use, not by rule id.
 *
 * This list is the answer to "why would I connect this", and it is the same
 * three rules `list_insights` reports as skipped without a provider. If the two
 * ever disagree, this is the one a person read.
 */
const UNLOCKED_RULES = [
  {
    title: "Seen but not clicked",
    detail:
      "Pages collecting impressions at a click-through rate below what this site's own pages at " +
      "the same ranking get. The ranking is working; the title and description are not.",
  },
  {
    title: "Near-miss rankings",
    detail:
      "Pages sitting just off the first page — position 11 rather than 10 — where a modest edit " +
      "moves real traffic. Impossible to see without average position.",
  },
  {
    title: "Decaying content",
    detail:
      "Pages whose impressions are falling compared with the previous period, before the traffic " +
      "loss is large enough to notice.",
  },
];

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

/**
 * Turns remaining seconds into something worth reading.
 *
 * An expired access token is deliberately *not* phrased as a problem. It is the
 * ordinary state of any connection more than an hour old, and the refresh token
 * renews it on the next read — a red "expired" badge here would be wrong every
 * time and would train its reader to ignore the badge that matters.
 */
function formatExpiry(seconds: number | null): string {
  if (seconds === null) return "no access token stored; one is minted on the next read";
  if (seconds <= 0) return "access token expired; it is renewed automatically on the next read";
  if (seconds < 120) return `access token expires in ${seconds}s`;
  return `access token expires in ${Math.round(seconds / 60)} min`;
}

export function AnalyticsPanel({
  siteSlug,
  siteBaseUrl,
  connections,
  missingEnv,
  callbackNotice,
  redirectUri,
}: {
  siteSlug: string;
  siteBaseUrl: string;
  connections: ConnectionView[];
  missingEnv: string[];
  callbackNotice: CallbackNotice | null;
  redirectUri: string;
}) {
  const [verdict, setVerdict] = useState<CallbackNotice | null>(null);
  const [pending, startTransition] = useTransition();

  const searchConsole = connections.find((c) => c.provider === "search_console") ?? null;
  const configured = missingEnv.length === 0;
  const notice = verdict ?? callbackNotice;

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p
          role="status"
          className={
            notice.tone === "error"
              ? "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
              : "rounded-lg border border-[var(--color-border)] bg-[var(--color-ok-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
          }
        >
          {notice.text}
        </p>
      )}

      {/* ---- what a connection is for ---------------------------------- */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          What Search Console unlocks
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Three of the six insight rules need impressions, click-through rate and average position.
          Without a connection they do not run at all, and Insights marks them as skipped rather
          than reporting that nothing was found.
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {UNLOCKED_RULES.map((rule) => (
            <li key={rule.title} className="border-l-2 border-[var(--color-border)] pl-3">
              <p className="text-sm font-medium text-[var(--color-ink)]">{rule.title}</p>
              <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{rule.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- the deployment is not configured -------------------------- */}
      {!configured && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-warn-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">
            Search Console is not available on this deployment
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
            {missingEnv.length === 1
              ? "One environment variable is missing:"
              : `${missingEnv.length} environment variables are missing:`}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {missingEnv.map((name) => (
              <li key={name}>
                <code className="font-mono text-xs text-[var(--color-ink)]">{name}</code>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--color-ink-muted)]">
            <p>
              <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> come from an OAuth
              client of type &ldquo;Web application&rdquo; in the Google Cloud console, with the
              Search Console API enabled on the project. Register this exact redirect URI on it:
            </p>
            <code className="ui-scroll overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2 py-1.5 font-mono text-xs whitespace-nowrap text-[var(--color-ink)]">
              {redirectUri}
            </code>
            <p>
              <code className="font-mono text-xs">ANALYTICS_ENCRYPTION_KEY</code> is 32 bytes —{" "}
              <code className="font-mono text-xs">openssl rand -hex 32</code>. It encrypts the
              stored refresh token, which cannot be hashed like an API key because it has to be
              replayed to Google. Nothing is ever stored unencrypted without it; the connection is
              refused instead.
            </p>
          </div>
        </section>
      )}

      {/* ---- the connection itself ------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Connections</h2>

        {searchConsole === null ? (
          <EmptyState
            bordered
            icon={ChartNoAxesColumnIcon}
            title="Search Console is not connected"
            description={`Connect a Google account holding a verified property for ${siteBaseUrl}.`}
            action={
              configured ? (
                <Button asChild>
                  {/*
                    A link, not a form. The next step is a top-level navigation
                    to accounts.google.com that must also set the nonce cookie,
                    which is a route handler's job rather than a server
                    action's.
                  */}
                  <a href={`/api/oauth/google/start?site=${encodeURIComponent(siteSlug)}`}>
                    Connect Search Console
                  </a>
                </Button>
              ) : (
                /* Disabled rather than hidden: the reason it is unavailable is
                   spelled out above, and a missing button reads as a bug. */
                <Button disabled>Connect Search Console</Button>
              )
            }
          />
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-[var(--color-ink)]">
                    {PROVIDER_LABELS[searchConsole.provider] ?? searchConsole.provider}
                  </h3>
                  <Badge variant={searchConsole.lastError ? "warning" : "success"}>
                    {searchConsole.lastError ? "Needs attention" : "Connected"}
                  </Badge>
                </div>
                <code className="mt-1 block truncate font-mono text-xs text-[var(--color-ink-secondary)]">
                  {searchConsole.propertyUrl}
                </code>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setVerdict(null);
                    startTransition(async () => {
                      const result = await testConnectionAction(siteSlug, searchConsole.provider);
                      if (!result.ok || !result.data) {
                        setVerdict({
                          tone: "error",
                          text: result.message ?? "The connection could not be tested.",
                        });
                        return;
                      }
                      setVerdict({
                        tone: result.data.ok ? "ok" : "error",
                        text: result.data.ok
                          ? `${result.data.message}${
                              result.data.accessTokenRefreshed
                                ? " The access token was renewed."
                                : ""
                            }`
                          : result.data.message,
                      });
                    });
                  }}
                >
                  {pending ? "Testing…" : "Test"}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Disconnect Search Console? The three search insight rules stop running " +
                          "immediately. This does not revoke the grant on Google's side — do " +
                          "that at myaccount.google.com/permissions.",
                      )
                    ) {
                      return;
                    }
                    setVerdict(null);
                    startTransition(async () => {
                      const result = await disconnectConnectionAction(
                        siteSlug,
                        searchConsole.provider,
                      );
                      if (!result.ok) {
                        setVerdict({
                          tone: "error",
                          text: result.message ?? "Could not disconnect.",
                        });
                      }
                    });
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-[var(--color-border)] pt-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--color-ink-muted)]">Last successful sync</dt>
                <dd className="text-[var(--color-ink)]">
                  {formatWhen(searchConsole.lastSyncedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-muted)]">Connected</dt>
                <dd className="text-[var(--color-ink)]">{formatWhen(searchConsole.createdAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[var(--color-ink-muted)]">Credential</dt>
                <dd className="text-[var(--color-ink)]">
                  Refresh token encrypted at rest; {formatExpiry(searchConsole.expiresInSeconds)}.
                </dd>
              </div>
            </dl>

            {searchConsole.lastError && (
              <div className="mt-3 rounded border border-[var(--color-border-strong)] bg-[var(--color-danger-surface)] p-3">
                <p className="text-sm font-medium text-[var(--color-ink)]">Last error</p>
                {/*
                  The provider's own words, not a paraphrase. "Google refused the
                  refresh token (invalid_grant)" tells an owner to reconnect;
                  "something went wrong" tells them to file a ticket.
                */}
                <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
                  {searchConsole.lastError}
                </p>
              </div>
            )}

            {configured && (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
                Pointing at the wrong property?{" "}
                <a
                  className="ui-focus-ring rounded text-[var(--color-ink)] underline decoration-[var(--color-border-strong)] underline-offset-2 hover:decoration-[var(--color-ink)]"
                  href={`/api/oauth/google/start?site=${encodeURIComponent(siteSlug)}`}
                >
                  Reconnect
                </a>{" "}
                to replace this connection.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
