import type { ComponentType } from "react";
import { CheckIcon, CircleAlertIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "../cn";
import { Badge, type BadgeVariant } from "./badge";

export interface LintCounts {
  errors: number;
  warnings: number;
}

export interface LintBadgeProps extends LintCounts {
  /**
   * Whether the document has ever been linted.
   *
   * "Checked, and clean" and "nobody has ever looked" are different facts, and
   * drawing them the same way quietly promises a review that never happened.
   * Defaults to `true` so that a caller that only has counts — which it can
   * only have if a check produced them — keeps its existing meaning.
   */
  checked?: boolean;
  /**
   * Drop the icon and keep the label.
   *
   * The label is what survives being read aloud, printed or scanned by someone
   * who cannot tell two greys apart, so it is never the half that goes. For a
   * count state the label is a numeral, which is already the smallest thing
   * this badge can be.
   */
  compact?: boolean;
  className?: string;
}

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

function describe({ errors, warnings }: LintCounts): string {
  if (errors === 0 && warnings === 0) return "No lint problems";
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(", ");
}

interface Appearance {
  variant: BadgeVariant;
  className?: string;
  Icon: IconComponent;
  text: string;
  description: string;
}

/**
 * Content quality at a glance, with severity carried by contrast rather than
 * by hue.
 *
 * The four states are drawn as four different amounts of ink, so that scanning
 * a column of these the eye lands on the blocking rows first without having to
 * read any of them:
 *
 *   errors        a solid inverted block — the darkest thing in its row
 *   warnings      an outlined chip in the mid grey — present, clearly lighter
 *   clean         a recessive chip in secondary ink — resolved, quiet
 *   never checked a dashed ring — an absence, not an outcome
 *
 * Errors outrank warnings rather than being summed: one error and nine
 * warnings is still "cannot publish", and an aggregate would bury that.
 *
 * The icon and the text both carry the meaning, so the badge survives being
 * read aloud, printed, or looked at by someone who cannot separate two greys.
 * `title` gives mouse users the same sentence assistive technology hears.
 */
function appearanceFor({ errors, warnings, checked }: LintCounts & { checked: boolean }): Appearance {
  if (!checked) {
    return {
      variant: "outline",
      // Dashed, because this is the absence of a result rather than a result.
      className: "border-dashed",
      Icon: MinusIcon,
      text: "Not checked",
      description: "Not checked. Lints run on preview and on publish.",
    };
  }

  if (errors > 0) {
    return {
      variant: "solid",
      Icon: CircleAlertIcon,
      text: String(errors),
      description: describe({ errors, warnings }),
    };
  }

  if (warnings > 0) {
    return {
      variant: "strong",
      Icon: TriangleAlertIcon,
      text: String(warnings),
      description: describe({ errors, warnings }),
    };
  }

  return {
    variant: "quiet",
    Icon: CheckIcon,
    text: "Clean",
    description: "Checked, no lint problems",
  };
}

export function LintBadge({
  errors,
  warnings,
  checked = true,
  compact,
  className,
}: LintBadgeProps) {
  const { variant, className: shape, Icon, text, description } = appearanceFor({
    errors,
    warnings,
    checked,
  });

  return (
    <Badge variant={variant} className={cn(shape, className)} title={description}>
      {!compact && <Icon aria-hidden="true" />}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{description}</span>
    </Badge>
  );
}
