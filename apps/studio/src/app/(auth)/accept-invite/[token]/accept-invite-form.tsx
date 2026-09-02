"use client";

import { useActionState } from "react";
import { acceptInviteAction, INITIAL_ACCEPT_STATE } from "./actions";
import * as s from "../../styles";

/**
 * The confirm step.
 *
 * Accepting is a POST behind a button rather than something that happens on
 * page load. Mail clients and security scanners fetch links in messages, and an
 * invitation that redeems itself on `GET` is an invitation consumed by a
 * scanner before its recipient ever clicks it — single-use, so there is no
 * second chance.
 */
export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL_ACCEPT_STATE);

  return (
    <form action={formAction} className={s.card}>
      <h1 className={s.heading}>Accept this invitation</h1>
      <p className={s.subheading}>
        You are signed in as <strong>{email}</strong>. Accepting adds this account to the site that
        invited you.
      </p>

      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p role="alert" className={s.alert}>
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${s.button} mt-6`}>
        {pending ? "Accepting…" : "Accept invitation"}
      </button>

      <p className={s.footnote}>
        Wrong account?{" "}
        <a className={s.link} href="/sign-in">
          Sign in as someone else
        </a>
      </p>
    </form>
  );
}
