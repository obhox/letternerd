import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registry } from "@cms/capabilities";
import { isCmsError, mcpAnnotations, rawShapeOf, type Actor } from "@cms/core";
import { db, storage, now } from "@/server/services";
import { SERVER_NAME, SERVER_VERSION } from "./catalog";


/**
 * The MCP server, assembled from the capability registry.
 *
 * This module holds no domain logic, exactly as `apps/mcp-stdio` holds none.
 * Both transports register the same registry in the same loop, so a capability
 * added to `@cms/capabilities` reaches an agent over stdio and over HTTP at the
 * same moment, with the same description, the same schema and the same
 * annotations. A remote endpoint that maintained its own tool list would be one
 * feature behind within a release.
 */

/**
 * Written for the agent that is about to read the tool list.
 *
 * Kept in step with the stdio server's wording deliberately: an agent that has
 * learned how this CMS behaves over one transport should not have to relearn it
 * over the other.
 */
const INSTRUCTIONS =
  "Content management for a headless, multi-site CMS. The API key you connected with is bound " +
  "to one site; no tool takes a site identifier. Publishing runs editorial lints as a hard gate " +
  "— if publish_document fails with a precondition error, the findings tell you what to fix. " +
  "Prefer render_preview to check your work before publishing: it runs the exact pipeline " +
  "publishing uses. Tools your key is not permitted to call are still listed; calling one " +
  "returns a `forbidden` error naming the scope or role it wanted.";

/**
 * Build a server bound to one actor.
 *
 * Every capability is registered, including ones this actor may not call.
 * That is deliberate: authorization lives in `capability.invoke`, which checks
 * scopes and role before any handler runs, and a transport that pre-filtered
 * the list would be a second opinion about permissions — the precise thing
 * `@cms/core/capability` exists to prevent. A read key therefore connects
 * successfully, sees the whole surface, and is refused with a `forbidden` tool
 * error naming the missing scope the moment it reaches for a write. That
 * refusal is more useful to an agent than a tool that silently does not exist.
 */
export function buildMcpServer(actor: Actor): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  for (const cap of registry.values()) {
    server.registerTool(
      cap.name,
      {
        title: cap.title,
        description: cap.description,
        inputSchema: rawShapeOf(cap),
        annotations: mcpAnnotations(cap),
      },
      async (input: unknown) => {
        try {
          const data = await cap.invoke(input, { actor, services: { db, storage, now } });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          /**
           * Domain failures come back as tool errors, not thrown exceptions.
           *
           * A refused publish is information the agent should act on — the lint
           * findings say exactly what to fix — so `details` is serialised into
           * the response rather than collapsed into a stack trace. Anything
           * that is not a `CmsError` is a bug in this system and is rethrown,
           * so it reaches the transport as a real error instead of being
           * reported to the agent as a domain refusal it could retry around.
           */
          if (isCmsError(error)) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: error.code, message: error.message, ...error.details },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          throw error;
        }
      },
    );
  }

  return server;
}
