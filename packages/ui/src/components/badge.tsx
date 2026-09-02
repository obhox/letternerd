import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

/**
 * Five silhouettes, no hue.
 *
 * The palette is achromatic, so a badge cannot say "bad" by being red. What is
 * left is *shape* and *contrast weight*, and those are the axes this file
 * spends. Read down the list and the ladder is legible without reading a word:
 *
 *   solid    a filled block at maximum contrast — the loudest thing in a row
 *   strong   outlined in the mid grey, on a faint fill — present, not urgent
 *   fill     a soft muted chip — a fact, neither good nor bad
 *   outline  a hairline ring on nothing — a label with no weight behind it
 *   quiet    a recessive chip in secondary ink — resolved, nothing to do
 *
 * The severity names (`danger`, `warning`, `success`) are kept as aliases onto
 * that ladder so existing callers keep working and keep meaning what they said.
 * `danger` is deliberately the same drawing as `accent`: in this system the
 * most serious thing on screen and the most important thing on screen are both
 * "the darkest block", and the label is what separates them.
 */

/* Maximum contrast. Inverted ink on an accent block; inverts again in dark. */
const SOLID =
  "border-transparent bg-[var(--color-accent)] font-semibold text-[var(--color-accent-ink)]";

/* Mid weight. `--grey-5` is the one ramp stop that clears 3:1 against both the
   light and the dark surface, so the ring is visible in either theme. */
const STRONG =
  "border-[var(--grey-5)] bg-[var(--color-warn-surface)] text-[var(--color-ink)]";

/* Neutral. A muted fill carries shape without carrying alarm. */
const FILL = "border-transparent bg-[var(--color-muted)] text-[var(--color-ink)]";

/* Unweighted. A ring and nothing else. */
const OUTLINE =
  "border-[var(--color-border-strong)] bg-transparent text-[var(--color-ink-secondary)]";

/* Recessive. Lighter ink, lighter weight, a fill barely off the surface. */
const QUIET =
  "border-[var(--color-border)] bg-[var(--color-ok-surface)] font-normal text-[var(--color-ink-muted)]";

export const badgeVariants = cva(
  cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 whitespace-nowrap",
    "text-xs leading-4 font-medium",
    // Badges carry an icon far more often than not, and every caller sizing it
    // by hand is how a column ends up with three different glyph sizes.
    "[&_svg]:size-3 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        /* The shape vocabulary. */
        solid: SOLID,
        strong: STRONG,
        fill: FILL,
        outline: OUTLINE,
        quiet: QUIET,

        /* Semantic aliases onto it. */
        default: FILL,
        accent: SOLID,
        danger: SOLID,
        warning: STRONG,
        success: QUIET,
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
