"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn.js";

export const buttonVariants = cva(
  "ui-focus-ring inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:opacity-90",
        secondary:
          "border-transparent bg-[var(--color-muted)] text-[var(--color-ink)] hover:bg-[var(--color-border)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-muted)]",
        outline:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-muted)]",
        danger:
          "border-transparent bg-[var(--color-danger)] text-[var(--color-accent-ink)] hover:opacity-90",
      },
      size: {
        // Deliberately short: this is a toolbar-heavy app and 32px rows keep
        // a full editor control strip on one line at 1280px.
        sm: "h-7 px-2 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-sm [&_svg]:size-4",
        icon: "size-8 p-0 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

interface ButtonBaseProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element instead of a `<button>`, keeping these styles. */
  asChild?: boolean;
}

/**
 * `size="icon"` makes `aria-label` mandatory.
 *
 * An icon-only button has no accessible name at all unless one is supplied,
 * and that is the single most common way this library could ship something
 * unusable to a screen reader. Making it a type error is cheaper than making
 * it a code review habit.
 */
export type ButtonProps =
  | (ButtonBaseProps & { size?: Exclude<ButtonSize, "icon"> })
  | (ButtonBaseProps & { size: "icon"; "aria-label": string });

export function Button(props: ButtonProps) {
  // The union above exists purely to constrain callers; inside the component
  // both arms have identical shape, so widening back is safe.
  const { className, variant, size, asChild = false, type, ...rest } = props as ButtonBaseProps;
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      // A bare <button> inside a form defaults to type="submit", which submits
      // the form on every toolbar click. When `asChild` is set the child may
      // not be a button at all, so the attribute is left alone.
      {...(asChild ? {} : { type: type ?? "button" })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    />
  );
}
