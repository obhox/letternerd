import type { Metadata } from "next";
import { safeRedirect } from "../redirect";
import * as s from "../styles";

export const metadata: Metadata = { title: "Email verification" };

/**
 * Where better-auth's verification link lands.
 *
 * The verification itself happens at `/api/auth/verify-email`, which consumes
 * the token and then redirects here — with `?error=<code>` if it could not. So
 * this page never sees a token and never verifies anything; it reads the
 * outcome of something that already happened. That separation is why the token
 * cannot leak into this page's URL, its metadata, or a `Referer` header.
 */
const MESSAGES: Record<string, { title: string; detail: string }> = {
  TOKEN_EXPIRED: {
    title: "That link has expired",
    detail:
      "Verification links are short-lived. Sign in again and we will send a fresh one to your address.",
  },
  INVALID_TOKEN: {
    title: "That link is not valid",
    detail:
      "It may have already been used, or the address may have been cut short by your mail client. Sign in again to request a new link.",
  },
  USER_NOT_FOUND: {
    title: "That link is not valid",
    detail: "The account it was issued for no longer exists. Create an account to continue.",
  },
  /**
   * better-auth returns this when a *different* account is signed in from the
   * one the link was issued for — a common outcome on a shared machine, and
   * one that reads as a broken link unless it is named.
   */
  INVALID_USER: {
    title: "Signed in as someone else",
    detail:
      "This link belongs to a different account than the one currently signed in. Sign out, then open the link again.",
  },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.error === "string" ? params.error : undefined;
  // `next` is attacker-controllable in exactly the way `redirect` is — this
  // page is reached by following a link from an email.
  const destination = safeRedirect(params.next);

  if (code) {
    const message = MESSAGES[code] ?? {
      title: "We could not verify that address",
      detail: "Sign in again to request a new verification link.",
    };

    return (
      <div className={s.card}>
        <h1 className={s.heading}>{message.title}</h1>
        <p role="alert" className={s.alert}>
          {message.detail}
        </p>
        <p className="mt-6">
          <a className={s.secondaryButton} href="/sign-in">
            Back to sign in
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className={s.card}>
      <h1 className={s.heading}>Email verified</h1>
      <p className={s.subheading}>
        Your address is confirmed. You can accept invitations and sign in normally from now on.
      </p>
      <p className="mt-6">
        <a className={s.button} href={destination}>
          Continue
        </a>
      </p>
    </div>
  );
}
