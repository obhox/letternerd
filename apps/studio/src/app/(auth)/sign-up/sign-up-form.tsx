"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { signUp } from "@/lib/auth-client";
import { safeRedirect } from "../redirect";
import * as s from "../styles";

/**
 * Matches `minPasswordLength` in `@cms/auth`. Stated in the form rather than
 * discovered by failing it: a rule a person only learns by breaking it is a
 * rule that costs them a round trip and their place in the form.
 */
const MIN_PASSWORD_LENGTH = 10;

const MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS: "An account already exists for that email address. Try signing in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account already exists for that email address. Try signing in instead.",
  INVALID_EMAIL: "That does not look like an email address.",
  PASSWORD_TOO_SHORT: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  PASSWORD_TOO_LONG: "That password is too long. Keep it under 256 characters.",
  SIGNUP_BY_INVITATION_ONLY:
    "This studio creates accounts by invitation only. Use the exact address your invitation was sent to.",
};

function messageFor(code: string | undefined, status: number | undefined): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (status === 429) {
    return "Too many sign-up attempts from this address. Try again later.";
  }
  return "The account could not be created. Please try again.";
}

export function SignUpForm({ redirectTo, invitationOnly = false }: { redirectTo: string; invitationOnly?: boolean }) {
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const passwordHintId = useId();

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Set when the account exists but cannot be used until its address is proved. */
  const [awaitingVerification, setAwaitingVerification] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      // Checked here purely to answer instantly; the server enforces it too,
      // and the server's answer is the one that counts.
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    const destination = safeRedirect(redirectTo);

    setPending(true);
    setError(null);

    const result = await signUp.email({
      name,
      email,
      password,
      /**
       * Where the link in the verification email lands. It goes to the status
       * page rather than straight to `destination` so that a failed or expired
       * verification has somewhere to say so — a redirect to the studio would
       * bounce straight back to sign-in with no explanation. The intended
       * destination rides along and is re-validated when that page reads it.
       */
      callbackURL:
        destination === "/"
          ? "/verify-email"
          : `/verify-email?next=${encodeURIComponent(destination)}`,
    });

    if (result.error) {
      setError(messageFor(result.error.code, result.error.status));
      setPending(false);
      return;
    }

    /**
     * better-auth withholds the session token when verification is required,
     * so a null token is the signal — not a guess about how this deployment is
     * configured. The client cannot read `CMS_REQUIRE_EMAIL_VERIFICATION`, and
     * should not: the server's actual behaviour is a better source than a
     * mirrored copy of its configuration.
     */
    if (!result.data?.token) {
      setAwaitingVerification(email);
      setPending(false);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  if (awaitingVerification) {
    return (
      <div className={s.card}>
        <h1 className={s.heading}>Check your email</h1>
        <p className={s.subheading}>
          We sent a confirmation link to <strong>{awaitingVerification}</strong>. Open it to finish
          setting up your account.
        </p>
        <p className={s.notice}>
          Nothing arrived? Check the spam folder. The link expires, so request a new one by signing
          in again if it has been a while.
        </p>
        <p className={s.footnote}>
          <a className={s.link} href="/sign-in">
            Back to sign in
          </a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={s.card} noValidate>
      <h1 className={s.heading}>Create an account</h1>
      <p className={s.subheading}>
        {invitationOnly
          ? "Use the address your invitation was sent to; no other address can register here."
          : "You will need an invitation to reach a site."}
      </p>

      <div className="mt-6">
        <label htmlFor={nameId} className={s.label}>
          Name
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          autoComplete="name"
          required
          autoFocus
          disabled={pending}
          className={s.input}
        />
      </div>

      <div className="mt-4">
        <label htmlFor={emailId} className={s.label}>
          Email address
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className={s.input}
        />
      </div>

      <div className="mt-4">
        <label htmlFor={passwordId} className={s.label}>
          Password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          // Tied to the input so a screen reader announces the rule when the
          // field is focused, rather than leaving it as unread text nearby.
          aria-describedby={passwordHintId}
          disabled={pending}
          className={s.input}
        />
        <p id={passwordHintId} className={s.hint}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      {error ? (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${s.button} mt-6`}>
        {pending ? "Creating account…" : "Create account"}
      </button>

      <p className={s.footnote}>
        Already have an account?{" "}
        <a
          className={s.link}
          href={`/sign-in?redirect=${encodeURIComponent(safeRedirect(redirectTo))}`}
        >
          Sign in
        </a>
      </p>
    </form>
  );
}
