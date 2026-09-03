import type { Metadata } from "next";
import { env } from "@/env";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { AnalyticsPanel } from "./analytics-panel";
import type { ConnectionView } from "./types";

export const metadata: Metadata = { title: "Analytics" };

/**
 * Where an owner connects Search Console, and where they find out why it is not
 * connected.
 *
 * The screen has two jobs and the second is the harder one. Connecting is a
 * button. Explaining a *missing* connection is what stops the insights screen
 * from being quietly misread: three of its six rules cannot run without this,
 * and "no findings" from a rule that never ran looks identical to "no findings"
 * from a rule that ran and found nothing.
 *
 * So a deployment with no Google application configured does not get an error
 * or a dead button — it gets the list of environment variables it is missing.
 */

interface ListConnectionsResult {
  connections: {
    id: string;
    provider: string;
    propertyUrl: string;
    scopes: string[];
    accessTokenExpiresAt: Date | null;
    connectedByUserId: string | null;
    lastSyncedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    expiresInSeconds: number | null;
  }[];
  availableProviders: readonly string[];
  searchRulesUnlocked: string[];
}

/**
 * The callback's error codes, turned into sentences here rather than passed
 * through the URL as text.
 *
 * A message carried in a query parameter is a message an attacker writes: React
 * escapes it, so it is not an XSS, but "Your session expired — sign in again at
 * <link>" rendered inside the studio's own chrome is a convincing phishing
 * surface. Codes in the URL, words in the code.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  forbidden: "Only a site owner can connect an analytics provider.",
  not_configured:
    "This studio has no Google application configured, so the consent screen cannot be opened.",
  no_encryption_key:
    "ANALYTICS_ENCRYPTION_KEY is not set. Credentials are encrypted at rest and there is no " +
    "unencrypted fallback, so the connection was not started.",
  google_denied: "Access was not granted on Google's consent screen. Nothing was stored.",
  no_code: "Google did not return an authorization code. Try connecting again.",
  exchange_failed:
    "Google rejected the authorization code. This usually means the redirect URI registered in " +
    "the Google Cloud console does not exactly match this studio's callback URL.",
  no_refresh_token:
    "Google returned an access token but no refresh token, so the connection would stop working " +
    "within the hour. Remove this studio's access at myaccount.google.com/permissions and " +
    "connect again.",
  no_property:
    "No verified Search Console property in that Google account matches this site's URL. Add and " +
    "verify the property in Search Console first, then connect again.",
  site_changed: "This site changed while the consent screen was open. Try connecting again.",
  save_failed: "The connection could not be saved. Nothing was stored.",
};

export default async function AnalyticsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { site: slug } = await params;
  const query = await searchParams;
  const ctx = await studioContext(slug);
  const result = await dispatchOrThrow<ListConnectionsResult>(ctx, "list_connections", {});

  // Dates cross into the browser bundle as ISO strings so they are formatted in
  // the reader's locale rather than the server's.
  const connections: ConnectionView[] = result.connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    propertyUrl: connection.propertyUrl,
    scopes: connection.scopes,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    createdAt: connection.createdAt.toISOString(),
    expiresInSeconds: connection.expiresInSeconds,
  }));

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const errorCode = first(query["error"]);
  const connected = first(query["connected"]);

  /**
   * The variables this deployment is missing, named individually.
   *
   * "Google is not configured" sends an operator to a wiki. A list of the exact
   * variable names sends them to the right three lines of their environment
   * file. `ANALYTICS_ENCRYPTION_KEY` is listed alongside the client credentials
   * because a deployment with the Google application but no key can walk the
   * whole consent screen and then fail to store the result.
   */
  const missingEnv = [
    env.GOOGLE_CLIENT_ID ? null : "GOOGLE_CLIENT_ID",
    env.GOOGLE_CLIENT_SECRET ? null : "GOOGLE_CLIENT_SECRET",
    env.ANALYTICS_ENCRYPTION_KEY ? null : "ANALYTICS_ENCRYPTION_KEY",
  ].filter((name): name is string => name !== null);

  return (
    <AnalyticsPanel
      siteSlug={slug}
      siteBaseUrl={ctx.site.baseUrl}
      connections={connections}
      missingEnv={missingEnv}
      callbackNotice={
        errorCode
          ? {
              tone: "error",
              text:
                CALLBACK_ERRORS[errorCode] ??
                "The connection did not complete. Nothing was stored.",
            }
          : connected
            ? {
                tone: "ok",
                /**
                 * The property is deliberately not echoed from the query
                 * string, for the same reason the errors are codes: it would
                 * be request-supplied text rendered inside the studio's own
                 * chrome. The connection below names the property that was
                 * actually stored, which is the value worth trusting.
                 */
                text: "Search Console connected.",
              }
            : null
      }
      redirectUri={new URL("/api/oauth/google/callback", env.CMS_STUDIO_URL).toString()}
    />
  );
}
