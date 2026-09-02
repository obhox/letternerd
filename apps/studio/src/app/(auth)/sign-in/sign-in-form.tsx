"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { signIn } from "@/lib/auth-client";
import { safeRedirect } from "../redirect";
import * as s from "../styles";

/**
 * Sign-in messages, keyed by better-auth's error codes.
 *
 * Two properties matter here and pull in opposite directions. The message must
 * be specific enough to act on, and it must not answer the question "does this
 * account exist?" — an endpoint that distinguishes a wrong password from an
 * unknown address is a free account enumerator, and better-auth returns a
 * single `INVALID_EMAIL_OR_PASSWORD` for both precisely so this layer cannot
 * accidentally take them apart again.
 *
 * `EMAIL_NOT_VERIFIED` is the exception, and safely so: it is only ever reached
 * by someone who has already supplied the correct password for that account.
 */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email address and password do not match an account.",
  INVALID_EMAIL: "That does not look like an email address.",
  EMAIL_NOT_VERIFIED:
    "Your email address has not been verified yet. Open the link in the message we sent you, then sign in again.",
  USER_NOT_FOUND: "That email address and password do not match an account.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "That email address and password do not match an account.",
};

function messageFor(code: string | undefined, status: number | undefined): string {
  if (code && MESSAGES[code]) return MESSAGES[code];

  /**
   * The rate limiter in `@cms/auth` allows five sign-in attempts every five
   * minutes. Saying so is worth more than a generic failure: someone who has
   * simply mistyped their password twice needs to know that trying harder is
   * now the wrong move.
   */
  if (status === 429) {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }

  return "Sign-in failed. Please try again.";
}

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setPending(true);
    setError(null);

    const result = await signIn.email({ email, password });

    if (result.error) {
      setError(messageFor(result.error.code, result.error.status));
      setPending(false);
      return;
    }

    /**
     * Re-validated even though the server already validated it into this prop.
     *
     * The check is cheap and the failure mode is not: this is the moment an
     * open redirect would fire, with a freshly authenticated user in hand. A
     * second call here means no future refactor of the page's props can quietly
     * remove the only guard.
     */
    const destination = safeRedirect(redirectTo);

    /**
     * `refresh()` before leaving, so the server components on the destination
     * re-render against the session cookie that was just set rather than
     * against whatever the router already had cached for a signed-out visitor.
     * `pending` is deliberately left true — the navigation is the rest of the
     * work, and re-enabling the button invites a second submit.
     */
    router.replace(destination);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={s.card} noValidate>
      <h1 className={s.heading}>Sign in</h1>
      <p className={s.subheading}>Continue to your sites.</p>

      <div className="mt-6">
        <label htmlFor={emailId} className={s.label}>
          Email address
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
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
          autoComplete="current-password"
          required
          disabled={pending}
          className={s.input}
        />
      </div>

      {error ? (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${s.button} mt-6`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className={s.footnote}>
        No account yet?{" "}
        <a
          className={s.link}
          href={`/sign-up?redirect=${encodeURIComponent(safeRedirect(redirectTo))}`}
        >
          Create one
        </a>
      </p>
    </form>
  );
}
