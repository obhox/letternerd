import type { Metadata } from "next";
import { safeRedirect } from "../redirect";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Second factor" };

/**
 * The second step of sign-in for an account with TOTP enrolled.
 *
 * Reached only with the challenge cookie better-auth set after a correct
 * password. There is nothing to read from the server here: the cookie is
 * httpOnly and the verification endpoint checks it, so this page is just the
 * form. `?redirect=` is narrowed to a same-origin path at the boundary, as on
 * the sign-in page it was carried from.
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <TwoFactorForm redirectTo={safeRedirect(params.redirect)} />;
}
