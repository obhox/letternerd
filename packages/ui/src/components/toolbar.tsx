"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../cn.js";
import { Separator } from "./separator.js";

export interface ToolbarProps extends Omit<ComponentPropsWithoutRef<"div">, "role"> {
  /**
   * Names the strip for assistive technology. Required in practice — a page
   * with an editor toolbar and a list toolbar gives a screen reader user two
   * identical "toolbar" landmarks otherwise.
   */
  "aria-label": string;
  children?: ReactNode;
}

/**
 * A horizontal control strip.
 *
 * `role="toolbar"` is applied without roving-tabindex key handling: the
 * children here are ordinary buttons, selects and menus that each want their
 * own Tab stop, and hijacking arrow keys would break the selects inside. If a
 * screen ever needs true roving focus, that screen should own it rather than
 * this component imposing it on every caller.
 */
export function Toolbar({ className, ...props }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex h-11 w-full items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2",
        className,
      )}
      {...props}
    />
  );
}

/** Groups related controls; `ml-auto` on the last group pushes it right. */
export function ToolbarGroup({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export function ToolbarSeparator({ className }: { className?: string }) {
  return <Separator orientation="vertical" className={cn("mx-1 h-5", className)} />;
}
