import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/**
 * Every better-auth endpoint, mounted at /api/auth/*.
 *
 * The catch-all is not laziness: better-auth's client builds its own paths
 * (`/sign-in/email`, `/verify-email`, `/get-session`, …) and adds more as the
 * library gains features. Enumerating them here would mean a route that exists
 * in the client and 404s on the server after an upgrade, which presents as a
 * mysteriously broken sign-in rather than as a build error.
 *
 * GET and POST only. better-auth's helper also offers PATCH, PUT and DELETE;
 * nothing in this app's configuration serves them, and an exported handler is
 * an exposed surface whether or not it routes anywhere.
 */
export const { GET, POST } = toNextJsHandler(auth.handler);

/**
 * Sessions and rate-limit buckets are per-request state. Any caching here would
 * serve one visitor's session to the next.
 */
export const dynamic = "force-dynamic";
