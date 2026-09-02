import type { Metadata } from "next";
import { safeRedirect } from "../redirect";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

/**
 * Sign-up carries `?redirect=` for one reason: an invitation link. Somebody
 * with no account opens `/accept-invite/<token>`, is sent here, and must land
 * back on that token afterwards rather than on an empty studio with no way to
 * find the invitation again. It is narrowed to a same-origin path here, at the
 * boundary, exactly as on the sign-in page.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <SignUpForm redirectTo={safeRedirect(params.redirect)} />;
}
