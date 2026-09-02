import { AlertTriangleIcon, CheckIcon, CircleAlertIcon } from "lucide-react";
import { Badge } from "./badge";

export interface LintCounts {
  errors: number;
  warnings: number;
}

export interface LintBadgeProps extends LintCounts {
  /** Hide the count text, leaving the icon and the screen-reader label. */
  compact?: boolean;
  className?: string;
}

function describe({ errors, warnings }: LintCounts): string {
  if (errors === 0 && warnings === 0) return "No lint problems";
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(", ");
}

/**
 * Content quality at a glance: red if anything blocks publishing, amber if
 * only advisories remain, green when clean.
 *
 * Errors outrank warnings rather than being summed — one error and nine
 * warnings is still "cannot publish", and an aggregate count would bury that.
 *
 * The icon and the count both carry the meaning, so the badge survives being
 * read aloud, printed in greyscale, or looked at by someone who cannot
 * separate the red from the green. The `title` gives mouse users the same
 * sentence assistive technology hears.
 */
export function LintBadge({ errors, warnings, compact, className }: LintBadgeProps) {
  const description = describe({ errors, warnings });

  const { variant, Icon, text } =
    errors > 0
      ? { variant: "danger" as const, Icon: CircleAlertIcon, text: String(errors) }
      : warnings > 0
        ? { variant: "warning" as const, Icon: AlertTriangleIcon, text: String(warnings) }
        : { variant: "success" as const, Icon: CheckIcon, text: "Clean" };

  return (
    <Badge variant={variant} className={className} title={description}>
      <Icon className="size-3" aria-hidden="true" />
      {!compact && <span aria-hidden="true">{text}</span>}
      <span className="sr-only">{description}</span>
    </Badge>
  );
}
