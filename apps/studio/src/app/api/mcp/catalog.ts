import { KEY_ROLES, KEY_SCOPES, atLeast, type AnyCapability } from "@cms/core";
import { registry } from "@cms/capabilities";

/**
 * What a connected agent sees, described once.
 *
 * This module deliberately pulls in neither the MCP SDK nor the service
 * container: `/api/mcp/info` and the settings screen both need this catalogue,
 * and neither of them should have to construct a database pool or an MCP
 * server to render a list of tool names.
 */

export const SERVER_NAME = "cms";
export const SERVER_VERSION = "0.1.0";
export const TRANSPORT = "streamable-http";
export const ENDPOINT_PATH = "/api/mcp";

/**
 * Section labels for the tool list, keyed by the first segment of a
 * capability's REST path.
 *
 * The grouping is derived rather than declared because a capability already
 * states where it lives in the URL space, and a second, hand-written taxonomy
 * would drift from it. An unrecognised segment falls through to "Other", which
 * is a nudge to add a label here rather than a broken screen.
 */
const GROUP_LABELS: Record<string, string> = {
  documents: "Documents",
  media: "Media",
  terms: "Taxonomy",
  authors: "Authors",
  redirects: "Redirects",
  insights: "Insights",
  settings: "Settings",
  site: "Site",
  scheduled: "Scheduling",
  jobs: "Scheduling",
  "render-preview": "Rendering",
};

export function groupOf(cap: AnyCapability): string {
  const [segment] = cap.route.path.replace(/^\//, "").split("/");
  return GROUP_LABELS[segment ?? ""] ?? "Other";
}

/**
 * The first sentence of a capability's description.
 *
 * Descriptions are written for an agent deciding whether to call a tool, so
 * they run to several sentences. A list of fifty of those is unreadable; the
 * opening sentence is the one that says what the tool does.
 */
export function summaryOf(cap: AnyCapability): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(cap.description.trim());
  return (match?.[0] ?? cap.description).trim();
}

const ADMIN_KEY_SCOPES = new Set<string>(KEY_SCOPES.admin);

/**
 * Whether the strongest API key can call this tool at all.
 *
 * No key type maps to `owner`, and none carries `site:admin`, so the settings
 * capabilities are reachable only by a person signed in to the studio. That is
 * the rule that stops a leaked key from minting a successor, and it is worth
 * stating on the screen: a connected agent sees these tools in its list and is
 * refused when it calls one, which reads like a bug unless somebody said so.
 */
function reachableByApiKey(cap: AnyCapability): boolean {
  return (
    atLeast(KEY_ROLES.admin, cap.role) && cap.scopes.every((scope) => ADMIN_KEY_SCOPES.has(scope))
  );
}

export interface ToolSummary {
  name: string;
  title: string;
  summary: string;
  group: string;
  readOnly: boolean;
  /** False for the tools only an owner's studio session can call. */
  keyReachable: boolean;
}

export interface ServerInfo {
  name: string;
  version: string;
  transport: string;
  endpoint: string;
  toolCount: number;
  tools: ToolSummary[];
}

/**
 * What `/api/mcp/info` serves, and what the settings screen renders.
 *
 * One function for both so the screen cannot describe a server the endpoint
 * does not serve. It reveals nothing beyond what a client sees the moment it
 * connects — tool names and their purposes — which is why the route around it
 * needs no authentication.
 */
export function serverInfo(): ServerInfo {
  const tools = [...registry.values()].map((cap) => ({
    name: cap.name,
    title: cap.title,
    summary: summaryOf(cap),
    group: groupOf(cap),
    readOnly: cap.readOnly ?? false,
    keyReachable: reachableByApiKey(cap),
  }));

  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: TRANSPORT,
    endpoint: ENDPOINT_PATH,
    toolCount: tools.length,
    tools,
  };
}
