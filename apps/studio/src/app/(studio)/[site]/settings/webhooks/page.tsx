import type { Metadata } from "next";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { WebhooksPanel } from "@/components/settings/webhooks-panel";
import type { WebhookView } from "@/components/settings/types";

export const metadata: Metadata = { title: "Webhooks" };

interface ListWebhooksResult {
  webhooks: { id: string; url: string; events: string[]; isActive: boolean; createdAt: Date }[];
  knownEvents: readonly string[];
}

export default async function WebhooksPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);
  const result = await dispatchOrThrow<ListWebhooksResult>(ctx, "list_webhooks", {});

  const webhooks: WebhookView[] = result.webhooks.map((webhook) => ({
    ...webhook,
    createdAt: webhook.createdAt.toISOString(),
  }));

  return (
    <WebhooksPanel siteSlug={slug} webhooks={webhooks} knownEvents={[...result.knownEvents]} />
  );
}
