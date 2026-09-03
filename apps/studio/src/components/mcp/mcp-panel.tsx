"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label } from "@cms/ui";
import type { ServerInfo } from "@/app/api/mcp/catalog";
import { createApiKeyAction } from "@/app/(studio)/[site]/settings/actions";
import { CopyOnceSecret } from "@/components/settings/copy-once";
import { CopyBlock } from "./copy-block";
import { ToolCatalog } from "./tool-catalog";

/**
 * How to point an AI client at this site.
 *
 * The screen answers one question and is ordered by the order in which someone
 * actually hits the obstacles: you need a key, then you need an address, then
 * you want to know what you have just handed over.
 *
 * The delicate part is the key. Keys are stored as a SHA-256 digest, so there
 * is no version of this screen that can fill a real key into a snippet for a
 * key that already exists — and pretending otherwise, by showing a masked value
 * or a "reveal" affordance, would be worse than the placeholder. So the
 * snippets carry `<your key>` and say so, and switch to the real value only for
 * the one render after a key is minted here, when this page genuinely holds it.
 */

/** Stands in for a key the server cannot recover. Deliberately unmistakable. */
const KEY_PLACEHOLDER = "<your key>";

const DATABASE_URL_PLACEHOLDER = "postgres://user:password@host:5432/cms";

export interface AdminKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function remoteCommand(url: string, key: string): string {
  return [
    `claude mcp add --transport http cms ${url} \\`,
    `  --header "Authorization: Bearer ${key}"`,
  ].join("\n");
}

function remoteJson(url: string, key: string): string {
  return JSON.stringify(
    { mcpServers: { cms: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );
}

function stdioCommand(key: string): string {
  return [
    "claude mcp add cms \\",
    `  --env CMS_API_KEY=${key} \\`,
    `  --env DATABASE_URL=${DATABASE_URL_PLACEHOLDER} \\`,
    "  -- pnpm --filter @cms/mcp-stdio start",
  ].join("\n");
}

function stdioJson(key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        cms: {
          command: "pnpm",
          args: ["--filter", "@cms/mcp-stdio", "start"],
          env: { CMS_API_KEY: key, DATABASE_URL: DATABASE_URL_PLACEHOLDER },
        },
      },
    },
    null,
    2,
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-6 first:border-0 first:pt-0">
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A date, written the same way on the server and in the browser.
 *
 * `toLocaleDateString` would be friendlier, and it is what the API keys table
 * does — but this component is server-rendered and then hydrated, and the two
 * runtimes disagree about locale and timezone, which makes every such date a
 * hydration mismatch that throws the whole root back to client rendering. These
 * two dates sit beside a key prefix in a line of small print; ISO is the right
 * register for them anyway, and it is unambiguous in every locale.
 */
function IsoDate({ iso }: { iso: string }) {
  return <time dateTime={iso}>{iso.slice(0, 10)}</time>;
}

export function McpPanel({
  siteSlug,
  remoteUrl,
  infoUrl,
  adminKeys,
  server,
}: {
  siteSlug: string;
  remoteUrl: string;
  infoUrl: string;
  adminKeys: AdminKeyView[];
  server: ServerInfo;
}) {
  const [name, setName] = useState("MCP client");
  const [created, setCreated] = useState<{ plaintext: string; notice: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const key = created?.plaintext ?? KEY_PLACEHOLDER;
  const usingRealKey = created !== null;

  return (
    <div className="flex flex-col gap-6">
      {created && (
        <CopyOnceSecret
          label={`API key "${created.name}"`}
          value={created.plaintext}
          notice={created.notice}
          // Dismissing drops the plaintext from this page, which is the point:
          // the snippets below revert to the placeholder at the same moment,
          // so the screen never shows a key it is no longer holding.
          onDismiss={() => setCreated(null)}
        />
      )}

      <Section title="What this is">
        <p className="text-sm text-[var(--color-ink-secondary)]">
          Every capability of this CMS is an MCP tool. A client that connects — Claude Code, Claude
          Desktop, or anything else that speaks MCP — can read, write, publish and inspect this
          site&rsquo;s content directly, with no separate integration to build. Connect over HTTP
          with an API key, or run the stdio server locally.
        </p>
      </Section>

      <Section title="1 · A key">
        <p className="text-sm text-[var(--color-ink-secondary)]">
          An admin key (<code className="font-mono text-xs">cms_ak_</code>) is what a client
          authenticates with. It is bound to this site alone, and no tool takes a site identifier,
          so a client cannot reach another site with it.
        </p>
        <p className="border-l-2 border-[var(--color-border-strong)] pl-3 text-sm text-[var(--color-ink)]">
          An admin key grants write access to this site&rsquo;s content through any client that
          holds it: creating, editing, publishing and deleting documents and media. It cannot change
          settings, manage members or mint further keys. Treat it as you would a deploy
          credential — and revoke it on the API keys screen if it goes anywhere you did not intend.
        </p>

        {adminKeys.length === 0 ? (
          <p className="text-sm text-[var(--color-ink)]">
            This site has no admin key yet, so nothing can connect. Create one to start.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-[var(--color-ink-secondary)]">
              {adminKeys.length === 1 ? "This site has one admin key" : `This site has ${adminKeys.length} admin keys`}
              . Only the prefix is shown: keys are stored as a digest and the value itself exists
              only in whatever you pasted it into.
            </p>
            <ul className="flex flex-col gap-1 pt-1">
              {adminKeys.map((adminKey) => (
                <li key={adminKey.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <code className="font-mono text-xs text-[var(--color-ink)]">
                    {adminKey.keyPrefix}…
                  </code>
                  <span className="text-[var(--color-ink)]">{adminKey.name}</span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    created <IsoDate iso={adminKey.createdAt} />
                    {adminKey.lastUsedAt === null ? (
                      // "Never used" and "used, we did not record when" are
                      // different facts; only the first is true here.
                      <>, never used</>
                    ) : (
                      <>
                        , last used <IsoDate iso={adminKey.lastUsedAt} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await createApiKeyAction(siteSlug, { name: name.trim(), type: "admin" });
              if (!result.ok || !result.data) {
                setError(result.message ?? "Could not create that key.");
                return;
              }
              setCreated({
                plaintext: result.data.plaintext,
                notice: result.data.notice,
                name: result.data.key.name,
              });
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-key-name">Name</Label>
            <Input
              id="mcp-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="MCP client"
              required
              className="w-56"
            />
          </div>
          <Button
            type="submit"
            variant={adminKeys.length === 0 ? "default" : "secondary"}
            disabled={pending || name.trim() === ""}
          >
            {pending ? "Creating…" : "Create a key for MCP"}
          </Button>
        </form>

        {error !== null && (
          <p role="alert" className="text-sm font-medium text-[var(--color-ink)]">
            {error}
          </p>
        )}

        <p className="text-sm text-[var(--color-ink-muted)]">
          {usingRealKey
            ? "The snippets below carry the key you just created. They will fall back to a placeholder once you dismiss the panel above."
            : `The snippets below use ${KEY_PLACEHOLDER} — replace it with the key you stored. An existing key cannot be shown again; if it is lost, create a new one and revoke the old.`}
        </p>
      </Section>

      <Section title="2 · Remote — over HTTP">
        <p className="text-sm text-[var(--color-ink-secondary)]">
          The endpoint speaks Streamable HTTP over POST and needs nothing installed. This is the
          one to use unless you are working in a checkout of the CMS itself.
        </p>
        <CopyBlock label="URL" value={remoteUrl} />
        <CopyBlock label="Claude Code command" value={remoteCommand(remoteUrl, key)} />
        <CopyBlock
          label="JSON configuration"
          value={remoteJson(remoteUrl, key)}
          description="For .mcp.json in a project, or a client that takes JSON directly."
        />
      </Section>

      <Section title="3 · Local — over stdio">
        <p className="text-sm text-[var(--color-ink-secondary)]">
          The stdio server runs on your machine and talks to the database directly, so it needs a
          checkout and a <code className="font-mono text-xs">DATABASE_URL</code> as well as a key.
          Use it when you are developing the CMS; otherwise prefer the remote endpoint.
        </p>
        <CopyBlock label="Claude Code command" value={stdioCommand(key)} />
        <CopyBlock
          label="JSON configuration"
          value={stdioJson(key)}
          description="For Claude Desktop, or any client configured by file."
        />
      </Section>

      <Section title="What a connected client sees">
        <p className="text-sm text-[var(--color-ink-secondary)]">
          {server.name} {server.version}, over {server.transport}. This is the list a client reads
          back on connecting — check it yourself at{" "}
          <a
            href={infoUrl}
            className="ui-focus-ring underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            /api/mcp/info
          </a>
          , which needs no key.
        </p>
        <ToolCatalog tools={server.tools} />
      </Section>
    </div>
  );
}
