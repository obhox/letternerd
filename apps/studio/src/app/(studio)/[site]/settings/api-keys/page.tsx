import type { Metadata } from "next";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import type { ApiKeyView } from "@/components/settings/types";

export const metadata: Metadata = { title: "API keys" };

interface ListApiKeysResult {
  keys: {
    id: string;
    name: string;
    type: string;
    keyPrefix: string;
    scopes: string[];
    allowedOrigins: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }[];
  activeCount: number;
  revokedCount: number;
}

export default async function ApiKeysPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);
  const result = await dispatchOrThrow<ListApiKeysResult>(ctx, "list_api_keys", {});

  // Dates become ISO strings at the boundary so the browser formats them in
  // the reader's own locale rather than the server's.
  const keys: ApiKeyView[] = result.keys.map((key) => ({
    ...key,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }));

  return <ApiKeysPanel siteSlug={slug} keys={keys} revokedCount={result.revokedCount} />;
}
