"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";

export function UserMenu({ email, role }: { email: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-t border-[var(--color-border)] px-3 py-3">
      <div className="px-2 pb-2">
        <div className="truncate text-xs text-[var(--color-ink-secondary)]" title={email}>
          {email}
        </div>
        <div className="text-2xs capitalize text-[var(--color-ink-faint)]">{role}</div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOut();
          // push and refresh: the layout is a server component and would
          // otherwise re-render from cache with the session that just ended.
          router.push("/sign-in");
          router.refresh();
        }}
        className="ui-focus-ring w-full rounded px-2 py-1.5 text-left text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-60"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
