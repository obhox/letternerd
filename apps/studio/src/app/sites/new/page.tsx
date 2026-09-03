import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/context";
import { CreateSiteForm } from "./create-site-form";

export const metadata: Metadata = { title: "Add a site" };

/**
 * Every signed-in account may create a site of its own and becomes that
 * site's owner immediately — see `packages/auth/src/sites.ts`. The only gate
 * here is being signed in at all.
 */
export default async function NewSitePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?redirect=/sites/new");

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <CreateSiteForm />
    </main>
  );
}
