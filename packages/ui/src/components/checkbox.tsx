"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn.js";

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "ui-focus-ring peer size-4 shrink-0 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors",
        "data-[state=checked]:border-[var(--color-accent)] data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:text-[var(--color-accent-ink)]",
        "data-[state=indeterminate]:border-[var(--color-accent)] data-[state=indeterminate]:bg-[var(--color-accent)] data-[state=indeterminate]:text-[var(--color-accent-ink)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {/* A dash, not a tick, for the "some rows selected" header checkbox —
            the two states must be told apart at a glance in a bulk-select bar. */}
        {props.checked === "indeterminate" ? (
          <MinusIcon className="size-3" strokeWidth={3} aria-hidden="true" />
        ) : (
          <CheckIcon className="size-3" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
