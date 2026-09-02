"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export const Tabs = TabsPrimitive.Root;

export type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex items-center gap-4 border-b border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export type TabsTriggerProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;

export function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // An underline rather than a pill: it costs no extra vertical space
        // above a table, and the 2px bar overlaps the list's own border.
        "ui-focus-ring-inset -mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-0.5 pb-2 text-sm font-medium text-[var(--color-ink-muted)] transition-colors",
        "hover:text-[var(--color-ink)]",
        "data-[state=active]:border-[var(--color-accent)] data-[state=active]:text-[var(--color-ink)]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export type TabsContentProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export function TabsContent({ className, ...props }: TabsContentProps) {
  return <TabsPrimitive.Content className={cn("ui-focus-ring pt-3", className)} {...props} />;
}
