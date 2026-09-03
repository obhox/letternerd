import { actorFromApiKey } from "@cms/auth";
import type { Actor } from "@cms/core";
import { originAllowed, verifyApiKey } from "@cms/db/api-keys";
import { db } from "@/server/services";

/**
 * The MCP endpoint's front door.
 *
 * The rules are `/api/v1`'s rules, because they are the same credential
 * namespace: a bearer API key, never a session cookie. A cookie-authenticated
 * MCP endpoint would be a CSRF surface — any page the user visits could drive
 * their CMS through it — so sessions are simply not a way in here.
 *
 * The refusals are shaped differently from `/api/v1`, and that is the point of
 * this file existing at all. An MCP client that gets a transport-level failure
 * cannot tell "your key is wrong" from "the server is broken", and the two want
 * completely different responses from whoever is watching. So an unauthenticated
 * call gets HTTP 401 with `WWW-Authenticate`, and a JSON-RPC error object in the
 * body so a client that only speaks JSON-RPC still has something to print.
 */

const REALM = 'Bearer realm="cms"';

/**
 * JSON-RPC's reserved application error range. -32001 is conventional for
 * "unauthorized" across MCP implementations; the HTTP status is what a client
 * should actually key on, and this is here so the body is not empty.
 */
const UNAUTHENTICATED_CODE = -32001;

export type AuthOutcome = { ok: true; actor: Actor } | { ok: false; response: Response };

function refusal(status: number, message: string, headers: Record<string, string>): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      // No request has been parsed yet, so there is no id to correlate with.
      id: null,
      error: { code: UNAUTHENTICATED_CODE, message, data: { error: "unauthenticated" } },
    },
    { status, headers },
  );
}

/**
 * Resolve `Authorization: Bearer …` to a site-scoped actor.
 *
 * The actor is built by `actorFromApiKey` and nowhere else, so the key's own
 * site, role and scopes decide what the connection can do. No tool input
 * carries a site id, which means there is no request an agent can compose that
 * reaches another tenant.
 */
export async function authenticate(request: Request): Promise<AuthOutcome> {
  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!presented) {
    return {
      ok: false,
      response: refusal(
        401,
        "Provide a CMS API key as `Authorization: Bearer <key>`. An admin key (cms_ak_…) is " +
          "needed for the tools that write; a read key (cms_sk_…) may connect and read.",
        { "WWW-Authenticate": REALM },
      ),
    };
  }

  const key = await verifyApiKey(db, presented);
  if (!key) {
    // Identical answer for malformed, unknown, revoked and expired keys: the
    // difference is not the caller's business and saying it aids a guesser.
    return {
      ok: false,
      response: refusal(401, "Invalid API key.", {
        "WWW-Authenticate": `${REALM}, error="invalid_token"`,
      }),
    };
  }

  const origin = request.headers.get("origin");
  if (origin !== null && !originAllowed(key, origin)) {
    /**
     * A secret or admin key arriving with an `Origin` header has leaked into
     * browser code. Refusing is how anyone finds out; quietly allowing it means
     * the leak is discovered by whoever exploits it. MCP clients are not
     * browsers and send no `Origin`, so this costs a legitimate caller nothing.
     */
    return {
      ok: false,
      response: Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: UNAUTHENTICATED_CODE,
            message: "This key may not be used from a browser.",
            data: { error: "forbidden" },
          },
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, actor: actorFromApiKey(key) };
}
