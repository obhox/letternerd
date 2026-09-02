import type { ReactNode } from "react";

/**
 * The shell for every page reachable without a session.
 *
 * There is deliberately no navigation, no site picker and no account menu. A
 * visitor here has no session, so every one of those would either be empty or
 * would need a session to populate — and a header that renders half of itself
 * is how a sign-in page starts throwing on a null user.
 *
 * The product name is the only chrome, and it earns its place: these pages ask
 * for a password, and a password prompt with no indication of what is being
 * signed in to is indistinguishable from a phishing page.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-canvas)] px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-[var(--color-ink-muted)]">
          CMS Studio
        </p>
      </div>
      {children}
    </div>
  );
}
