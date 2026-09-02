import { z } from "zod";
import { currentUser, dispatch, studioContext } from "@/server/context";

/**
 * One file per request, base64 in a JSON body.
 *
 * A route handler rather than a server action because the studio shows a
 * progress bar per file, and only a real XHR gives the browser something to
 * report progress against. It contains no logic of its own beyond parsing the
 * envelope: authorization, the size ceiling, deduplication and the actual
 * pipeline all live in `upload_media`, so an upload through MCP and an upload
 * through drag-and-drop cannot diverge.
 *
 * One file per request is what makes a partial batch survivable — the client
 * fires one of these per dropped file, and a rejected PDF in the middle does
 * not take the other nine photographs down with it.
 */

export const dynamic = "force-dynamic";
/** Large images on a slow uplink; the default 15s is not enough. */
export const maxDuration = 120;

const bodySchema = z.object({
  site: z.string().min(1),
  filename: z.string().min(1).max(300),
  contentBase64: z.string().min(1),
  alt: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  // Checked before `studioContext`, which answers a signed-out visitor with a
  // redirect — correct for a page, useless to `fetch`.
  if (!(await currentUser())) {
    return Response.json({ ok: false, message: "Your session has expired." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Malformed request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, message: "Malformed upload request." }, { status: 400 });
  }

  const { site, ...input } = parsed.data;
  const ctx = await studioContext(site);
  const result = await dispatch(ctx, "upload_media", input);

  if (!result.ok) {
    return Response.json(
      { ok: false, code: result.code, message: result.message, details: result.details },
      { status: result.status },
    );
  }

  const data = result.data as { deduped: boolean; asset: { id: string } };
  return Response.json({ ok: true, deduped: data.deduped, id: data.asset.id });
}
