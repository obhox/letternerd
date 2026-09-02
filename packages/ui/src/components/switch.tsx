"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn.js";

export type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "ui-focus-ring peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors",
        "data-[state=unchecked]:bg-[var(--color-border)] data-[state=checked]:bg-[var(--color-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-[var(--color-surface)] shadow-sm transition-transform",
          "data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
