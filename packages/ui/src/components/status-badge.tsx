import { Badge, type BadgeVariant } from "./badge";

export const DOCUMENT_STATUSES = [
  "draft",
  "in_review",
  "scheduled",
  "published",
  "archived",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * The single definition of what a status looks like and is called.
 *
 * Colour is a strong signal, and a status that is grey on the list screen and
 * green in the editor teaches people two contradictory things. Every surface
 * reads this map, so there is nowhere for a second interpretation to live.
 *
 * `scheduled` shares the warn hue with `in_review` deliberately: both mean
 * "not live yet, and something still has to happen". The label carries the
 * difference, as it must — colour is never the only signal.
 */
const STATUS_STYLES: Record<DocumentStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "outline" },
  in_review: { label: "In review", variant: "accent" },
  scheduled: { label: "Scheduled", variant: "warning" },
  published: { label: "Published", variant: "success" },
  archived: { label: "Archived", variant: "default" },
};

/** The human-readable name, for menus, filters and prose outside a badge. */
export function statusLabel(status: DocumentStatus): string {
  return STATUS_STYLES[status].label;
}

export interface StatusBadgeProps {
  status: DocumentStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant={style.variant} className={className}>
      {style.label}
    </Badge>
  );
}
