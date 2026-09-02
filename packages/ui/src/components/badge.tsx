import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

/**
 * Status colours are tinted backgrounds rather than solid fills.
 *
 * A list screen shows dozens of these at once; solid danger red down a whole
 * column turns a table into an alarm. `color-mix` against the surface keeps
 * the hue readable in both themes without a second set of tokens.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--color-muted)] text-[var(--color-ink)]",
        outline: "border-[var(--color-border)] bg-transparent text-[var(--color-ink-muted)]",
        accent:
          "border-transparent bg-[color-mix(in_oklch,var(--color-accent)_14%,var(--color-surface))] text-[var(--color-accent)]",
        success:
          "border-transparent bg-[color-mix(in_oklch,var(--color-ok)_16%,var(--color-surface))] text-[var(--color-ok)]",
        warning:
          "border-transparent bg-[color-mix(in_oklch,var(--color-warn)_20%,var(--color-surface))] text-[var(--color-warn)]",
        danger:
          "border-transparent bg-[color-mix(in_oklch,var(--color-danger)_14%,var(--color-surface))] text-[var(--color-danger)]",
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
