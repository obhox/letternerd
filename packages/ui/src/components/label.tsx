"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm leading-none font-medium text-[var(--color-ink)] select-none",
        // Radix marks the wrapper when the labelled control is disabled, which
        // is the only way to dim a label without threading a prop through.
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
