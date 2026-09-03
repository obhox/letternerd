import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate } from "./auth";
import { ENDPOINT_PATH } from "./catalog";
import { buildMcpServer } from "./server";

/**
 * The remote MCP endpoint: every capability, over Streamable HTTP.
 *
 * The stdio server in `apps/mcp-stdio` needs a checkout, a `DATABASE_URL` and a
 * process on the operator's own machine. This is the same registry, the same
 * loop and the same authorization, reachable by any client that can make an
 * HTTPS request with a bearer token — which is what "MCP-first" has to mean for
 * anyone who is not running the repository locally.
 *
 * `StreamableHTTPServerTransport` — the class the SDK names for Node — is a
 * thin wrapper that converts `IncomingMessage`/`ServerResponse` into the Web
 * `Request`/`Response` this transport already speaks. A Next route handler is
 * handed a Web `Request` to begin with, so it uses the wrapped class directly
 * and skips the round trip through Node's HTTP objects. It is the same
 * transport and the same wire protocol.
 */

export const dynamic = "force-dynamic";
/** A render_preview over a long document is the slow case, not a hung one. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const outcome = await authenticate(request);
  if (!outcome.ok) return outcome.response;

  /**
   * A server and a transport per request, never at module scope.
   *
   * Next route handlers are stateless and horizontally scaled: two requests
   * from two different customers can be served by the same module instance, and
   * a transport hoisted out of this function would hold one caller's session
   * state — its stream mapping, its pending request ids — while answering
   * another's. The actor is baked into the server at construction, so sharing
   * one across requests would also mean sharing one tenant's credentials with
   * the next caller. Building both here costs a few objects and makes that
   * class of bug unrepresentable.
   */
  const server = buildMcpServer(outcome.actor);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: nothing survives the response, so there is no session to name.
    sessionIdGenerator: undefined,
    // One JSON body per POST rather than an SSE stream. Serverless request
    // handlers are not a good home for a long-lived stream, and every tool here
    // is a single request/response with no progress to report.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    // Resolves only once every response in the batch is assembled, so the body
    // is complete before the server below is torn down.
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

/**
 * No standalone SSE stream, and said out loud.
 *
 * The spec lets a server open a GET stream for messages it initiates. Nothing
 * here initiates any: tools answer the call that made them. A client that opens
 * this expecting a stream would otherwise wait on a connection that will never
 * carry anything, which is the most expensive kind of nothing to debug — so it
 * gets a 405 naming the method that does work.
 */
export function GET(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32601,
        message:
          `${ENDPOINT_PATH} speaks Streamable HTTP over POST only. This server initiates no ` +
          `messages, so there is no SSE stream to open. See ${ENDPOINT_PATH}/info for the tool ` +
          "list.",
        data: { error: "method_not_allowed" },
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
