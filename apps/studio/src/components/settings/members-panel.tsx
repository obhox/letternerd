"use client";

import { useState, useTransition } from "react";
import { UsersIcon } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from "@cms/ui";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type SiteRole } from "@cms/core/roles";
import {
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from "@/app/(studio)/[site]/settings/actions";
import { CopyOnceSecret } from "./copy-once";
import type { InvitationView, MemberView } from "./types";

/**
 * People and their access.
 *
 * Two rules from the capability layer show up in this UI, and both are shown
 * rather than merely enforced: the last owner's controls are disabled with the
 * reason attached, and the invite form offers no owner option because an
 * invitation cannot grant one. Neither is the enforcement — the server refuses
 * regardless — but a control that fails when clicked teaches people the app is
 * unreliable, while one that explains itself teaches them the rule.
 */
export function MembersPanel({
  siteSlug,
  currentUserId,
  members,
  invitations,
  ownerCount,
  assignableRoles,
  invitableRoles,
}: {
  siteSlug: string;
  currentUserId: string;
  members: MemberView[];
  invitations: InvitationView[];
  ownerCount: number;
  assignableRoles: string[];
  invitableRoles: string[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(invitableRoles[0] ?? "author");
  const [invited, setInvited] = useState<{ link: string; notice: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** True for the one member whose removal or demotion would strand the site. */
  const isLastOwner = (member: MemberView) => member.role === "owner" && ownerCount === 1;
  const LAST_OWNER_REASON =
    "This is the site's only owner. Promote someone else to owner first — a site with no owner cannot be administered by anyone.";

  const columns: DataTableColumn<MemberView>[] = [
    {
      key: "person",
      header: "Person",
      render: (member) => (
        <div className="flex flex-col">
          <span className="font-medium">{member.name ?? member.email ?? member.userId}</span>
          {member.email && (
            <span className="text-xs text-[var(--color-ink-muted)]">{member.email}</span>
          )}
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      width: "12rem",
      render: (member) => {
        const locked = isLastOwner(member);
        return (
          <Select
            value={member.role}
            disabled={locked || pending}
            onValueChange={(next) => {
              setError(null);
              startTransition(async () => {
                const result = await updateMemberRoleAction(siteSlug, member.userId, next);
                if (!result.ok) setError(result.message ?? "Could not change that role.");
              });
            }}
          >
            <SelectTrigger
              className="w-full"
              aria-label={`Role for ${member.email ?? member.userId}`}
              title={locked ? LAST_OWNER_REASON : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((value) => (
                <SelectItem key={value} value={value}>
                  {ROLE_LABELS[value as SiteRole] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      key: "you",
      header: "",
      render: (member) =>
        member.userId === currentUserId ? <Badge variant="accent">You</Badge> : null,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (member) => {
        const locked = isLastOwner(member);
        return (
          <Button
            variant="ghost"
            size="sm"
            disabled={locked || pending}
            title={locked ? LAST_OWNER_REASON : undefined}
            onClick={() => {
              const who = member.email ?? member.userId;
              const self = member.userId === currentUserId;
              if (
                !window.confirm(
                  self
                    ? `Remove your own access to this site? You will lose it immediately and will need another owner to invite you back.`
                    : `Remove ${who} from this site? Their documents and revisions are kept and stay attributed to them.`,
                )
              ) {
                return;
              }
              startTransition(async () => {
                const result = await removeMemberAction(siteSlug, member.userId);
                if (!result.ok) setError(result.message ?? "Could not remove that member.");
              });
            }}
          >
            Remove
          </Button>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {invited && (
        <CopyOnceSecret
          label={`Invitation for ${invited.email}`}
          value={invited.link}
          notice={invited.notice}
          onDismiss={() => setInvited(null)}
        />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--color-surface))] p-3 text-sm text-[var(--color-ink)]"
        >
          {error}
        </p>
      )}

      {ownerCount === 1 && (
        <p
          role="status"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm text-[var(--color-ink-muted)]"
        >
          This site has one owner. Their role and their access are locked until a second owner
          exists — losing the only owner would leave the site with nobody able to manage members,
          keys or settings.
        </p>
      )}

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Invite someone</h2>
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await inviteMemberAction(siteSlug, { email, role });
              if (!result.ok || !result.data) {
                setError(result.message ?? "Could not create that invitation.");
                return;
              }
              setInvited({
                // The capability returns a root-relative path — it has no
                // business knowing this studio's hostname. The browser does.
                link: `${window.location.origin}${result.data.acceptPath}`,
                notice: result.data.notice,
                email: result.data.invitation.email,
              });
              setEmail("");
            });
          }}
        >
          <Field
            label="Email address"
            description="The invitation works only for this address, and only once the account behind it has verified its email."
          >
            {({ id, ...wiring }) => (
              <Input
                id={id}
                {...wiring}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </Field>

          <Field
            label="Role"
            description={
              (ROLE_DESCRIPTIONS[role as SiteRole] ?? "") +
              " An invitation cannot grant ownership — promote an existing member instead."
            }
          >
            {({ id }) => (
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invitableRoles.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ROLE_LABELS[value as SiteRole] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <p className="text-sm text-[var(--color-ink-muted)]">
            No email is sent from here yet. The link is shown once, for you to pass on.
          </p>

          <Button type="submit" disabled={pending || email.trim() === ""}>
            {pending ? "Creating…" : "Create invitation"}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Members</h2>
        <DataTable
          columns={columns}
          rows={members}
          getRowKey={(member) => member.userId}
          caption="People with access to this site"
          empty={<EmptyState icon={UsersIcon} title="No members" />}
        />
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">Pending invitations</h2>
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
                <Badge variant="outline">{ROLE_LABELS[invitation.role as SiteRole] ?? invitation.role}</Badge>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
