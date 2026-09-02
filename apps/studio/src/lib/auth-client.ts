"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser half of better-auth.
 *
 * This module is bundled and shipped, so it must never import `@/env` — that
 * module holds `DATABASE_URL` and `BETTER_AUTH_SECRET`, and one import would
 * put both in a JavaScript file served to anyone who loads the sign-in page.
 * The single value needed here comes from a `NEXT_PUBLIC_` variable, which is
 * public by construction and therefore cannot leak anything by accident.
 *
 * When that variable is unset the client falls back to the page's own origin,
 * which is the right answer anyway: this code only ever runs inside the studio,
 * so the studio's origin is wherever it is currently loaded from. Naming an
 * origin explicitly matters only behind a proxy that rewrites the host — and
 * there, a wrong `NEXT_PUBLIC_CMS_STUDIO_URL` is a visible CORS failure rather
 * than a silent one.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_CMS_STUDIO_URL,
  basePath: "/api/auth",
});

export const { signIn, signUp, signOut, useSession } = authClient;
