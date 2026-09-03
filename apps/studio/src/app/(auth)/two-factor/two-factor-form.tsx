"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { safeRedirect } from "../redirect";
import * as s from "../styles";

/**
 * One field, two modes: the six-digit code from an authenticator, or one of
 * the backup codes issued at enrolment.
 *
 * The messages never say which factor was wrong beyond "that code was not
 * accepted": a backup code is a credential, and the endpoint's own lockout and
 * rate limit are what make guessing pointless.
 */
function messageFor(status: number | undefined): string {
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return "That code was not accepted. Check the time on your device and try again.";
}

export function TwoFactorForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const codeId = useId();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";

    setPending(true);
    setError(null);

    const result =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });

    if (result.error) {
      setError(messageFor(result.error.status));
      setPending(false);
      return;
    }

    const destination = safeRedirect(redirectTo);
    router.replace(destination);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={s.card} noValidate>
      <h1 className={s.heading}>Enter your code</h1>
      <p className={s.subheading}>
        {mode === "totp"
          ? "Open your authenticator app and enter the six-digit code for CMS Studio."
          : "Enter one of the backup codes you saved when you set up two-factor sign-in."}
      </p>

      <div className="mt-6">
        <label htmlFor={codeId} className={s.label}>
          {mode === "totp" ? "Authenticator code" : "Backup code"}
        </label>
        <input
          id={codeId}
          name="code"
          type="text"
          inputMode={mode === "totp" ? "numeric" : "text"}
          autoComplete="one-time-code"
          pattern={mode === "totp" ? "[0-9 ]*" : undefined}
          required
          autoFocus
          disabled={pending}
          className={s.input}
        />
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--color-ink)]">
        <input type="checkbox" name="trust" className="ui-focus-ring size-4 accent-[var(--color-accent)]" />
        Remember this device for 30 days
      </label>

      {error ? (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${s.button} mt-6`}>
        {pending ? "Checking…" : "Continue"}
      </button>

      <p className={s.footnote}>
        <button
          type="button"
          className={s.link}
          onClick={() => {
            setMode(mode === "totp" ? "backup" : "totp");
            setError(null);
          }}
        >
          {mode === "totp" ? "Use a backup code instead" : "Use my authenticator app instead"}
        </button>
      </p>
    </form>
  );
}
