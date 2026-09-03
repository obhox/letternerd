"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSite } from "@cms/auth";
import { createLogger, isCmsError } from "@cms/core";
import { createDb } from "@cms/db";
import { getSession } from "@/lib/auth";
import { RULES, rateLimit } from "@/server/rate-limit";

const log = createLogger("create-site");

export interface CreateSiteState {
  /** Present only after a failed attempt; a fresh form carries `null`. */
  error: string | null;
}

export const INITIAL_CREATE_SITE_STATE: CreateSiteState = { error: null };

/**
 * Create a site and its owner membership for the signed-in account.
 *
 * There is no site to scope this to yet, so it does not go through
 * `dispatch`/`studioContext` the way every other studio mutation does — see
 * `packages/auth/src/sites.ts` for why that door does not fit this action.
 * The session is read here, on the server, rather than trusted from the form:
 * a `userId` field on a request body is a `userId` field an attacker can set.
 */
export async function createSiteAction(
  _previous: CreateSiteState,
  formData: FormData,
): Promise<CreateSiteState> {
  const name = String(formData.get("name") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();

  const requestHeaders = await headers();
  const session = await getSession(requestHeaders);
  if (!session) {
    redirect("/sign-in?redirect=/sites/new");
  }

  const budget = rateLimit(RULES.createSite, session.user.id);
  if (!budget.allowed) {
    return { error: `Too many sites created recently. Wait ${budget.retryAfterSeconds} seconds and try again.` };
  }

  let created: Awaited<ReturnType<typeof createSite>>;
  try {
    created = await createSite({ db: createDb(), userId: session.user.id, name, baseUrl });
  } catch (error) {
    if (!isCmsError(error)) {
      log.error("create-site failed", { error });
      return { error: "Something went wrong creating that site. Please try again." };
    }

    // `createSite` only ever throws `invalid_input` or `conflict`, and both
    // carry a message written for exactly this screen.
    return { error: error.message };
  }

  // Outside the `try`: `redirect` signals by throwing, and a `catch` around
  // it would swallow the navigation and report a failure for work that
  // already succeeded.
  redirect(`/${created.slug}`);
}
