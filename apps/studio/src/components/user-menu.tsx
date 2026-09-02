"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@cms/ui";
import { signOut } from "@/lib/auth-client";

export function UserMenu({ role }: { role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[var(--color-ink-muted)]">{role}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOut();
          // refresh() as well as push(): the layout is a server component and
          // would otherwise render from cache with the old session.
          router.push("/sign-in");
          router.refresh();
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
