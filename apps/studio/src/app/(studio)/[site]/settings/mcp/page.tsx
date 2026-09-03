import type { Metadata } from "next";
import { can } from "@cms/core";
import { serverInfo } from "@/app/api/mcp/catalog";
import { env } from "@/env";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { McpPanel, type AdminKeyView } from "@/components/mcp/mcp-panel";
import type { ApiKeyView } from "@/components/settings/types";

export const metadata: Metadata = { title: "MCP" };

interface ListApiKeysResult {
  keys: (Omit<ApiKeyView, "lastUsedAt" | "expiresAt" | "revokedAt" | "createdAt"> & {
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  })[];
}

/**
 * The connection screen.
 *
 * `list_api_keys` is owner-only and would refuse an editor on its own, but the
 * refusal would arrive as a thrown error and a 500-shaped page. The role is
 * checked here first so a non-owner who follows a link gets a sentence instead,
 * and `can.manageApiKeys` is the same predicate the capability uses — this is a
 * nicer rendering of the server's answer, not a second opinion about it.
 */
export default async function McpSettingsPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);

  if (!can.manageApiKeys(ctx.role)) {
    return (
      <p className="text-sm text-[var(--color-ink-secondary)]">
        Connecting an AI client means issuing an API key, which only a site owner can do. Ask an
        owner of this site to set it up.
      </p>
    );
  }

  const result = await dispatchOrThrow<ListApiKeysResult>(ctx, "list_api_keys", {});

  /**
   * Admin keys only, and prefixes only.
   *
   * A read key can connect but cannot write, so it is not what this screen is
   * about; a publishable key cannot even be used here. The prefix is all the
   * server holds — the plaintext exists once, at creation — so this list can
   * confirm that a key exists and nothing more, which is exactly the question
   * someone has when a client says it is unauthorized.
   */
  const adminKeys: AdminKeyView[] = result.keys
    .filter((key) => key.type === "admin" && key.revokedAt === null)
    .map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      // ISO across the boundary so the browser formats in the reader's locale.
      createdAt: key.createdAt.toISOString(),
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    }));

  /**
   * The origin comes from configuration, never from a request header.
   *
   * `Host` and `X-Forwarded-Host` are attacker-controlled, and this screen's
   * whole output is a config block someone will paste into a client along with
   * a live credential. A spoofed host here is a key mailed to a stranger.
   */
  const origin = env.CMS_STUDIO_URL.replace(/\/+$/, "");

  return (
    <McpPanel
      siteSlug={slug}
      remoteUrl={`${origin}/api/mcp`}
      infoUrl={`${origin}/api/mcp/info`}
      adminKeys={adminKeys}
      server={serverInfo()}
    />
  );
}
