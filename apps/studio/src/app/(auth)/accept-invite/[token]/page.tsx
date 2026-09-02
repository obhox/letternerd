import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import * as s from "../../styles";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = { title: "Accept invitation" };

/**
 * A session is read on every request, so nothing here may be cached — a
 * rendered "signed in as…" served to the next visitor would be both wrong and
 * a disclosure.
 */
export const dynamic = "force-dynamic";

/**
 * The landing page for an invitation link.
 *
 * It deliberately does not look the token up. Rendering anything derived from
 * the invitation — the site's name, the inviter, the address it was sent to —
 * before anyone has authenticated would answer "is this token real?" for
 * whoever asks, and the token is the entire credential. Everything specific
 * appears only after the redemption in `actions.ts` has run against a real
 * session, which is also the only place that can decide it.
 *
 * So a signed-out visitor sees exactly the same page for a genuine token, an
 * expired one and a fabricated one.
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSession(await headers());

  if (!session) {
    /**
     * The token travels through sign-in as the `redirect` target, so the
     * visitor returns here rather than to an empty studio with no way back to
     * an invitation they may only have received once.
     *
     * `encodeURIComponent` on the whole path, not on the token alone: the
     * token is base64url and contains no characters that need escaping, but
     * this value is arriving from a URL and is not this page's to trust.
     */
    const back = encodeURIComponent(`/accept-invite/${token}`);

    return (
      <div className={s.card}>
        <h1 className={s.heading}>You have been invited</h1>
        <p className={s.subheading}>
          Sign in to accept this invitation. If the invitation was sent to an address you have not
          used here before, create an account with that address first.
        </p>

        <div className="mt-6 space-y-3">
          <a className={s.button} href={`/sign-in?redirect=${back}`}>
            Sign in
          </a>
          <a className={s.secondaryButton} href={`/sign-up?redirect=${back}`}>
            Create an account
          </a>
        </div>
      </div>
    );
  }

  return <AcceptInviteForm token={token} email={session.user.email} />;
}
