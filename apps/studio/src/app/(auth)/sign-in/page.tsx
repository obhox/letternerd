import type { Metadata } from "next";
import { safeRedirect } from "../redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `?redirect=` is resolved on the server, before the form is ever rendered.
 *
 * Doing it here rather than reading `useSearchParams` in the client component
 * means the untrusted value is narrowed to a same-origin path once, at the
 * boundary, and the browser never receives the original string at all. It also
 * keeps this page out of the Suspense dance that a client-side search-param
 * read would otherwise require.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <SignInForm redirectTo={safeRedirect(params.redirect)} />;
}
