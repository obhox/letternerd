import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * Plain `clsx` would emit both `px-2` and `px-4` and leave the outcome to
 * stylesheet order, which is invisible at the call site. `twMerge` resolves
 * the conflict by the order the caller wrote, so a `className` prop passed
 * into a component reliably overrides that component's own defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
