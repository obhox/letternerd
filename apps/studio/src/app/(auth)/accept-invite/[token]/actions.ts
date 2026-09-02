"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acceptInvitation, hashInvitationToken } from "@cms/auth";
import { isCmsError } from "@cms/core";
import { createDb } from "@cms/db";
import * as schema from "@cms/db/schema";
import { getSession } from "@/lib/auth";

export interface AcceptInviteState {
  /** Present only after a failed attempt; a fresh form carries `null`. */
  error: string | null;
}

export const INITIAL_ACCEPT_STATE: AcceptInviteState = { error: null };

/**
 * A `not_found` must read the same whether the token never existed, was
 * withdrawn, or was mistyped.
 *
 * `acceptInvitation` is careful not to distinguish those cases, and this
 * message must not undo that care by being specific. Anything that separates
 * "no such invitation" from "that invitation is gone" turns this page into an
 * oracle for guessing tokens — slowly, but an oracle nonetheless.
 */
const UNKNOWN_TOKEN =
  "This invitation link is not valid. It may have been withdrawn, or the link may be incomplete — " +
  "check that you copied the whole address, or ask whoever invited you to send a new one.";

/**
 * The address an invitation was issued to, for the wrong-account message.
 *
 * Only ever called after `acceptInvitation` has already thrown `forbidden`,
 * which means the caller demonstrably holds a valid token for a live
 * invitation. They can therefore learn nothing here they did not already have;
 * `packages/auth/src/invitations.ts` makes the same argument for answering
 * `forbidden` rather than `not_found` on a mismatched address. Calling this
 * before that point would leak invitees' email addresses to anyone guessing
 * tokens.
 */
async function invitedAddress(token: string): Promise<string | null> {
  try {
    const db = createDb();
    const invitation = await db.query.siteInvitations.findFirst({
      where: (i, { eq }) => eq(i.tokenHash, hashInvitationToken(token)),
      columns: { email: true },
    });
    return invitation?.email ?? null;
  } catch {
    // A failed lookup costs a less specific message and nothing else. It must
    // not turn a handled refusal into an unhandled exception.
    return null;
  }
}

/**
 * Redeem an invitation for the signed-in account.
 *
 * The session's `userId`, `email` and `emailVerified` are read here from the
 * server's own session, never from the form. A form field for any of the three
 * would be a field an attacker can set — `emailVerified: true` on a request
 * body is the entire attack that `@cms/auth`'s verification policy exists to
 * prevent.
 */
export async function acceptInviteAction(
  _previous: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: UNKNOWN_TOKEN };

  const session = await getSession(await headers());
  if (!session) {
    // The session expired between rendering the page and submitting it. Send
    // them back through sign-in with the token intact rather than reporting a
    // failure they cannot act on.
    redirect(`/sign-in?redirect=${encodeURIComponent(`/accept-invite/${token}`)}`);
  }

  try {
    await acceptInvitation({
      db: createDb(),
      token,
      userId: session.user.id,
      userEmail: session.user.email,
      emailVerified: session.user.emailVerified,
    });
  } catch (error) {
    if (!isCmsError(error)) {
      // Anything unrecognised is a bug or an outage. It is logged for whoever
      // is on call and reduced to a sentence for the person in front of the
      // screen — a stack trace here would leak internals and help nobody.
      console.error("accept-invite failed", error);
      return { error: "Something went wrong accepting this invitation. Please try again." };
    }

    switch (error.code) {
      case "not_found":
        return { error: UNKNOWN_TOKEN };

      case "conflict":
        return {
          error:
            "This invitation has already been accepted. If you cannot see the site, ask whoever " +
            "invited you to check that your account is still a member.",
        };

      case "precondition_failed":
        return {
          error: "This invitation has expired. Ask whoever invited you to send a new link.",
        };

      case "forbidden": {
        /**
         * `acceptInvitation` refuses for two quite different reasons under one
         * code, and the two need opposite advice — one says "go and verify your
         * address", the other says "you are signed in as the wrong person".
         * They are told apart by a fact this server already holds rather than
         * by matching on the error's prose, which is not an interface and will
         * be reworded eventually.
         */
        if (!session.user.emailVerified) {
          return {
            error:
              "Verify your email address before accepting this invitation. Open the confirmation " +
              "link we sent you, then come back to this page.",
          };
        }

        const address = await invitedAddress(token);
        return {
          error: address
            ? `This invitation was sent to ${address}, and you are signed in as ${session.user.email}. ` +
              "Sign out and sign in with that address to accept it."
            : `This invitation was sent to a different email address than ${session.user.email}. ` +
              "Sign out and sign in with the invited address to accept it.",
        };
      }

      default:
        return { error: error.message };
    }
  }

  /**
   * Both statements sit outside the `try`. `redirect` signals by throwing, so a
   * `catch` around it would swallow the navigation and report a failure for
   * work that succeeded.
   *
   * The destination is the studio root rather than the newly joined site: which
   * URL a site lives at belongs to the studio's own routing, and the root
   * already resolves to the right place for someone with exactly one
   * membership.
   */
  revalidatePath("/", "layout");
  redirect("/");
}
