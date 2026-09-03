import type { Metadata } from "next";
import { env } from "@/env";
import { safeRedirect } from "../redirect";
import * as s from "../styles";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

/**
 * Sign-up carries `?redirect=` for one reason: an invitation link. Somebody
 * with no account opens `/accept-invite/<token>`, is sent here, and must land
 * back on that token afterwards rather than on an empty studio with no way to
 * find the invitation again. It is narrowed to a same-origin path here, at the
 * boundary, exactly as on the sign-in page.
 *
 * When an operator has closed registration (`CMS_ALLOW_SIGNUP=false`) the
 * form is rendered only for someone arriving from an invitation.
 * The server refuses every other address regardless — the hook in `@cms/auth`
 * is the boundary — but a form that can only fail is a worse answer than a
 * sentence that says why.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirect(params.redirect);

  // Somebody arriving from an invitation link may register even when the
  // studio is otherwise closed: the server admits only invited addresses.
  const fromInvitation = redirectTo.startsWith("/accept-invite/");

  if (!env.CMS_ALLOW_SIGNUP && !fromInvitation) {
    return (
      <div className={s.card}>
        <h1 className={s.heading}>Accounts are by invitation</h1>
        <p className={s.subheading}>
          This studio does not accept self-service registration. Ask a site owner to invite you; the
          link they send will create your account.
        </p>
        <p className="mt-6">
          <a className={s.secondaryButton} href={`/sign-in?redirect=${encodeURIComponent(redirectTo)}`}>
            Back to sign in
          </a>
        </p>
      </div>
    );
  }

  return <SignUpForm redirectTo={redirectTo} invitationOnly={!env.CMS_ALLOW_SIGNUP} />;
}
