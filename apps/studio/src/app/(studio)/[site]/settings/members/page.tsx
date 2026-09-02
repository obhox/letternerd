import type { Metadata } from "next";
import { currentUser, dispatchOrThrow, studioContext } from "@/server/context";
import { MembersPanel } from "@/components/settings/members-panel";
import type { InvitationView, MemberView } from "@/components/settings/types";

export const metadata: Metadata = { title: "Members" };

interface ListMembersResult {
  members: {
    membershipId: string;
    userId: string;
    role: string;
    createdAt: Date;
    email: string | null;
    name: string | null;
  }[];
  pendingInvitations: { id: string; email: string; role: string; expiresAt: Date }[];
  ownerCount: number;
  assignableRoles: string[];
  invitableRoles: string[];
}

export default async function MembersPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);
  const [result, user] = await Promise.all([
    dispatchOrThrow<ListMembersResult>(ctx, "list_members", {}),
    currentUser(),
  ]);

  const members: MemberView[] = result.members.map((member) => ({
    userId: member.userId,
    role: member.role,
    email: member.email,
    name: member.name,
    createdAt: member.createdAt.toISOString(),
  }));

  const invitations: InvitationView[] = result.pendingInvitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
  }));

  return (
    <MembersPanel
      siteSlug={slug}
      currentUserId={user?.id ?? ""}
      members={members}
      invitations={invitations}
      ownerCount={result.ownerCount}
      assignableRoles={result.assignableRoles}
      invitableRoles={result.invitableRoles}
    />
  );
}
