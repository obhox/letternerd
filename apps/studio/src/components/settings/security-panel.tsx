"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, Card, CardContent, Input, Label } from "@cms/ui";
import { authClient } from "@/lib/auth-client";
import { CopyOnceSecret } from "./copy-once";

/**
 * TOTP enrolment, in the order an authenticator app expects it.
 *
 * 1. Confirm the password — better-auth requires it to mint a secret, so a
 *    session that was left open on a shared machine cannot quietly add a
 *    factor the account holder does not control.
 * 2. Add the secret to the app. The `otpauth://` URI is offered as a link,
 *    which a phone opens straight into the app, and the raw secret is shown
 *    for manual entry; no QR image is rendered because that would mean a
 *    dependency on the one screen that must keep working when nothing else
 *    does.
 * 3. Prove the app agrees by entering one code. Enrolment is not complete
 *    until it does — a secret nobody typed in correctly is a lockout waiting
 *    to happen.
 * 4. Save the backup codes, shown once.
 */
type Step =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "verify"; totpURI: string; secret: string; backupCodes: string[] }
  | { kind: "backup"; backupCodes: string[] };

function secretFrom(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function SecurityPanel({
  siteSlug,
  enabled,
  required,
  requiredRole,
  role,
}: {
  siteSlug: string;
  enabled: boolean;
  required: boolean;
  requiredRole: string | null;
  role: string;
}) {
  const router = useRouter();
  const passwordId = useId();
  const codeId = useId();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  async function refreshSession() {
    // The session cookie caches the user for a minute; ask for the live row
    // so the gate sees the enrolment that just happened.
    await authClient.getSession({ query: { disableCookieCache: true } });
    router.refresh();
  }

  async function enable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    setStep({ kind: "pending" });
    const result = await authClient.twoFactor.enable({ password });
    if (result.error || !result.data || result.data.method !== "totp") {
      setError(result.error?.status === 429 ? "Too many attempts. Wait a few minutes." : "That password was not accepted.");
      setStep({ kind: "idle" });
      return;
    }
    setStep({
      kind: "verify",
      totpURI: result.data.totpURI,
      secret: secretFrom(result.data.totpURI),
      backupCodes: result.data.backupCodes,
    });
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== "verify") return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.error) {
      setError("That code was not accepted. Check the time on your device and try again.");
      return;
    }
    setStep({ kind: "backup", backupCodes: step.backupCodes });
    await refreshSession();
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    const result = await authClient.twoFactor.disable({ password });
    if (result.error) {
      setError("That password was not accepted.");
      return;
    }
    await refreshSession();
  }

  return (
    <div className="space-y-4">
      {required ? (
        <p role="alert" className="rounded-md border border-[var(--color-warn)] px-3 py-2 text-sm text-[var(--color-ink)]">
          Two-factor sign-in is required for the <span className="capitalize">{requiredRole}</span> role on this
          studio. Finish setting it up below to continue to <span className="font-medium">{siteSlug}</span>.
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-3 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">Two-factor sign-in</h2>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {enabled
              ? "Enabled. Signing in asks for a code from your authenticator app after your password."
              : "Off. A password alone is enough to sign in to this account."}
            {requiredRole ? ` Required for the ${requiredRole} role and above; you are ${role === "owner" ? "an" : "a"} ${role}.` : ""}
          </p>

          {step.kind === "backup" ? (
            <CopyOnceSecret
              label="Backup codes"
              value={step.backupCodes.join("  ")}
              notice="Each code signs you in once if you lose your authenticator. They are not shown again."
              onDismiss={() => setStep({ kind: "idle" })}
            />
          ) : null}

          {!enabled && (step.kind === "idle" || step.kind === "pending") ? (
            <form onSubmit={enable} className="space-y-3">
              <div>
                <Label htmlFor={passwordId}>Confirm your password</Label>
                <Input id={passwordId} name="password" type="password" autoComplete="current-password" required />
              </div>
              <Button type="submit" disabled={step.kind === "pending"}>
                {step.kind === "pending" ? "Preparing…" : "Set up two-factor sign-in"}
              </Button>
            </form>
          ) : null}

          {step.kind === "verify" ? (
            <form onSubmit={verify} className="space-y-3">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-ink)]">
                <li>
                  Add this account to your authenticator app.{" "}
                  <a className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline" href={step.totpURI}>
                    Open in authenticator
                  </a>
                  , or enter the key by hand:
                  <code className="ui-scroll mt-1 block overflow-x-auto rounded border border-[var(--color-border)] px-2 py-1 font-mono text-xs">
                    {step.secret}
                  </code>
                </li>
                <li>Enter the six-digit code the app now shows.</li>
              </ol>
              <div>
                <Label htmlFor={codeId}>Code</Label>
                <Input id={codeId} name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
              </div>
              <Button type="submit">Confirm and enable</Button>
            </form>
          ) : null}

          {enabled && step.kind === "idle" ? (
            <form onSubmit={disable} className="space-y-3">
              <div>
                <Label htmlFor={passwordId}>Confirm your password to turn it off</Label>
                <Input id={passwordId} name="password" type="password" autoComplete="current-password" required />
              </div>
              <Button type="submit" variant="outline">
                Turn off two-factor sign-in
              </Button>
            </form>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
