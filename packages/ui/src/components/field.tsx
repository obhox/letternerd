"use client";

import { useId, type ReactNode } from "react";
import { cn } from "../cn";
import { Label } from "./label";

export interface FieldRenderProps {
  id: string;
  /** Spread onto the control: wires the description and error to it. */
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
}

export interface FieldProps {
  label: ReactNode;
  /** Helper text. Announced with the control, before any error. */
  description?: ReactNode;
  /** Presence switches the field into its invalid state. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /**
   * Supply an id to match a control you are rendering yourself; otherwise one
   * is generated. The render form always receives the id that was used.
   */
  id?: string;
  /**
   * Either a render function receiving the wiring, or plain children. Prefer
   * the function — passing children means you are responsible for putting the
   * id and `aria-describedby` on the control yourself.
   */
  children: ReactNode | ((props: FieldRenderProps) => ReactNode);
}

/**
 * Label, control, description and error, wired together.
 *
 * The wiring is the whole reason this exists. `htmlFor` alone gets the label
 * read out; without `aria-describedby` the hint and the error are visible text
 * that a screen reader user simply never encounters, and without
 * `aria-invalid` the control sounds fine while outlined in red.
 */
export function Field({
  label,
  description,
  error,
  required,
  className,
  id,
  children,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;

  const hasDescription = description !== undefined && description !== null;
  const hasError = error !== undefined && error !== null && error !== false;

  // Description first: it explains the field, and the error explains this
  // attempt. Read in that order the correction makes sense.
  const describedBy =
    [hasDescription ? descriptionId : null, hasError ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(" ") || undefined;

  const rendered =
    typeof children === "function"
      ? children({
          id: controlId,
          "aria-describedby": describedBy,
          "aria-invalid": hasError ? true : undefined,
        })
      : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={controlId}>
        {label}
        {required && (
          <>
            {/* The asterisk is decorative; `required` on the control is what
                actually announces the constraint, so this must not be read. */}
            <span aria-hidden="true" className="ml-0.5 text-[var(--color-danger)]">
              *
            </span>
          </>
        )}
      </Label>
      {rendered}
      {hasDescription && (
        <p id={descriptionId} className="text-xs text-[var(--color-ink-muted)]">
          {description}
        </p>
      )}
      {hasError && (
        // `role="alert"` so a validation failure arriving after submit is
        // spoken without the user having to go hunting for it.
        <p id={errorId} role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
