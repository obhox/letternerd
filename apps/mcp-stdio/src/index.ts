#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registry } from "@cms/capabilities";
import { isCmsError, mcpAnnotations, rawShapeOf, type Actor } from "@cms/core";
import { createDb } from "@cms/db";
import { verifyApiKey } from "@cms/db/api-keys";
import { actorFromApiKey } from "@cms/auth";
import { createStorage } from "@cms/media";


/**
 * The stdio MCP server.
 *
 * Every tool here is a capability from the registry — this file registers them
 * in a loop and contains no domain logic of its own. That is the whole design:
 * a capability added to `@cms/capabilities` becomes an MCP tool, a REST route
 * and a studio action at once, so no surface can fall behind the others.
 *
 * Authentication is an API key in the environment rather than a session. A key
 * belongs to exactly one site, so the agent's tenant is fixed before any tool
 * runs and no tool input carries a site id — there is no code path where a
 * caller chooses its own tenant.
 *
 *   claude mcp add cms -- pnpm --filter @cms/mcp-stdio start
 *   CMS_API_KEY=cms_ak_… DATABASE_URL=postgres://…
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // stderr, never stdout: stdout is the JSON-RPC channel and anything else
    // written there corrupts the protocol before the client can report why.
    console.error(`[cms-mcp] ${name} is not set.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const apiKey = requireEnv("CMS_API_KEY");

  const db = createDb(databaseUrl);
  const verified = await verifyApiKey(db, apiKey);
  if (!verified) {
    console.error("[cms-mcp] CMS_API_KEY is not a valid, live key.");
    process.exit(1);
  }

  const actor: Actor = actorFromApiKey(verified);

  const storage = createStorage({
    driver: (process.env.MEDIA_STORAGE_DRIVER as "s3" | "local") ?? "local",
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "auto",
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    cdnBaseUrl: process.env.MEDIA_CDN_URL,
  });

  const services = { db, storage, now: () => new Date() };

  const server = new McpServer(
    { name: "cms", version: "0.1.0" },
    {
      instructions:
        "Content management for a headless, multi-site CMS. This key is bound to one site; " +
        "no tool takes a site identifier. Publishing runs editorial lints as a hard gate — " +
        "if publish_document fails with a precondition error, the findings tell you what to " +
        "fix. Prefer render_preview to check your work before publishing: it runs the exact " +
        "pipeline publishing uses.",
    },
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
          const data = await cap.invoke(input, { actor, services });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          /**
           * Domain failures come back as tool errors, not thrown exceptions.
           *
           * A refused publish is information the agent should act on — the lint
           * findings say exactly what to fix — so the details are serialised
           * into the response rather than collapsed into a stack trace.
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

  await server.connect(new StdioServerTransport());
  console.error(`[cms-mcp] ready — ${registry.size} tools, site ${actor.siteId}`);
}

main().catch((error) => {
  console.error("[cms-mcp] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
