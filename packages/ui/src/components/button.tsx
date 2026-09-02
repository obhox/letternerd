"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

/**
 * Three weights, in order: solid, outlined, bare.
 *
 * With no hue to spend, a button's importance is how much ink it occupies.
 * `default` is a filled block at maximum contrast and there should be one of
 * them on a screen; `secondary` and `outline` are rings; `ghost` is a word
 * that only grows a background when you point at it.
 *
 * `danger` is the exception to "loudest wins". A destructive button drawn as a
 * solid block would be indistinguishable from the primary one here, so it is
 * drawn as a heavy two-pixel ring instead — it reads as deliberate rather than
 * as the obvious next step, which is the right feeling for Delete, and it
 * fills in on hover so the commitment is visible before the click lands.
 */
export const buttonVariants = cva(
  cn(
    "ui-focus-ring inline-flex items-center justify-center gap-1.5 rounded-md border",
    "font-medium whitespace-nowrap transition-colors select-none",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-hover)]",
        // `--grey-5` rather than `--color-border-strong`: it is the one ramp
        // stop that clears 3:1 against both the light and the dark surface, so
        // the ring around an interactive control is actually perceivable in
        // either theme rather than only in one.
        secondary:
          "border-[var(--grey-5)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-muted)]",
        outline:
          "border-[var(--grey-5)] bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-muted)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-ink-secondary)] hover:bg-[var(--color-muted)] hover:text-[var(--color-ink)]",
        danger:
          "border-2 border-[var(--color-danger)] bg-transparent text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-accent-ink)]",
      },
      size: {
        // Deliberately short: this is a toolbar-heavy app and 32px rows keep
        // a full editor control strip on one line at 1280px. The horizontal
        // padding grows faster than the height so the larger sizes read as
        // more substantial rather than merely taller.
        sm: "h-7 gap-1 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-sm [&_svg]:size-4",
        lg: "h-9 px-4 text-sm [&_svg]:size-4",
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
