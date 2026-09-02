import type { ComponentType } from "react";
import {
  ArchiveIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  EyeIcon,
  PencilLineIcon,
} from "lucide-react";
import { cn } from "../cn";
import { Badge, type BadgeVariant } from "./badge";

export const DOCUMENT_STATUSES = [
  "draft",
  "in_review",
  "scheduled",
  "published",
  "archived",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/**
 * The single definition of what a status looks like and is called.
 *
 * A status that is one shape on the list screen and another in the editor
 * teaches people two contradictory things, so every surface reads this map.
 *
 * With no hue available, the five states are separated by *silhouette* first —
 * you should be able to tell a published document from a draft at the edge of
 * vision, before either word is legible:
 *
 *   published   a solid inverted block. Live, and the only status with weight.
 *   scheduled   a dashed ring. Real, but not yet — the dash is the "not yet".
 *   in_review   a filled chip. Something is happening to it.
 *   draft       a hairline ring. Present, unweighted, nobody has acted.
 *   archived    bare text. Deliberately the least thing in the row.
 *
 * The icon repeats the distinction for anyone scanning glyphs rather than
 * shapes, and it is `aria-hidden`: the label is the accessible name, always.
 */
const STATUS_STYLES: Record<
  DocumentStatus,
  { label: string; variant: BadgeVariant; className?: string; Icon: IconComponent }
> = {
  draft: {
    label: "Draft",
    variant: "outline",
    Icon: PencilLineIcon,
  },
  in_review: {
    label: "In review",
    variant: "fill",
    Icon: EyeIcon,
  },
  scheduled: {
    label: "Scheduled",
    variant: "outline",
    // Dashed and a stop darker than `draft`: a scheduled document is a
    // commitment that has not landed, which is exactly what a dashed edge
    // means everywhere else in an interface.
    className: "border-dashed border-[var(--grey-5)] text-[var(--color-ink)]",
    Icon: CalendarClockIcon,
  },
  published: {
    label: "Published",
    variant: "solid",
    Icon: CircleCheckIcon,
  },
  archived: {
    label: "Archived",
    variant: "quiet",
    // No ring, no fill. Archived rows should sink.
    className: "border-transparent bg-transparent px-0",
    Icon: ArchiveIcon,
  },
};

/** The human-readable name, for menus, filters and prose outside a badge. */
export function statusLabel(status: DocumentStatus): string {
  return STATUS_STYLES[status].label;
}

export interface StatusBadgeProps {
  status: DocumentStatus;
  /** Drop the icon, for rows so tight the glyph is noise. The label stays. */
  iconless?: boolean;
  className?: string;
}

export function StatusBadge({ status, iconless = false, className }: StatusBadgeProps) {
  const { label, variant, className: shape, Icon } = STATUS_STYLES[status];

  return (
    <Badge variant={variant} className={cn(shape, className)}>
      {!iconless && <Icon aria-hidden="true" />}
      {label}
    </Badge>
  );
}
