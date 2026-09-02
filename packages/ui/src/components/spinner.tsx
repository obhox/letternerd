"use client";

import { Loader2Icon } from "lucide-react";
import { cn } from "../cn";

export interface SpinnerProps {
  className?: string;
  size?: "sm" | "md";
  /**
   * Announced to assistive technology as a live status. Omit it when the
   * spinner sits inside something that already says what is happening (a
   * button labelled "Saving…"), so the same fact is not read out twice.
   */
  label?: string;
}

export function Spinner({ className, size = "md", label }: SpinnerProps) {
  const icon = (
    <Loader2Icon
      className={cn("animate-spin text-current", size === "sm" ? "size-3.5" : "size-4", className)}
      aria-hidden="true"
    />
  );

  if (label === undefined) return icon;

  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
