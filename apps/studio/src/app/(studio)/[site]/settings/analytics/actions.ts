"use server";

import { revalidatePath } from "next/cache";
import { dispatch, studioContext } from "@/server/context";

/**
 * The two mutations this screen owns.
 *
 * Connecting is not among them: it is a redirect to Google, so it is a link to
 * `/api/oauth/google/start`, not an action. These two are ordinary capability
 * calls and go through `dispatch` like every other settings mutation — the
 * owner-only check lives in the capability, once, rather than being restated
 * per transport.
 *
 * Failures come back as values. An exception crossing the server-action
 * boundary in production is replaced by an opaque digest, and the messages here
 * — "Google refused the refresh token", "the property has no data yet" — are
 * the entire point of pressing Test.
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

async function call<T>(
  siteSlug: string,
  capability: string,
  input: unknown,
): Promise<ActionResult<T>> {
  const ctx = await studioContext(siteSlug);
  const result = await dispatch<T>(ctx, capability, input);

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(`/${siteSlug}/settings/analytics`);
  // The insights screen changes the moment a provider appears or disappears —
  // three rules start or stop running — so a stale cache there would show
  // "skipped: no analytics provider" on a site that just connected one.
  revalidatePath(`/${siteSlug}/insights`);
  return { ok: true, data: result.data };
}

export interface TestVerdict {
  ok: boolean;
  provider: string;
  propertyUrl: string;
  message: string;
  retryable?: boolean;
  accessTokenRefreshed: boolean;
  rowsSeen: number;
}

export async function testConnectionAction(
  siteSlug: string,
  provider: string,
): Promise<ActionResult<TestVerdict>> {
  return call<TestVerdict>(siteSlug, "test_connection", { provider });
}

export async function disconnectConnectionAction(
  siteSlug: string,
  provider: string,
): Promise<ActionResult> {
  return call(siteSlug, "disconnect_connection", { provider });
}
