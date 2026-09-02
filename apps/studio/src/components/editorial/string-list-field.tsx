"use client";

import { useId, useRef } from "react";
import { Button, Input } from "@cms/ui";

/**
 * A repeatable list of single-line values, submitted under one field name.
 *
 * A textarea would be less code, but `sameAs` entries are URLs: `type="url"`
 * gets browser validation and the right keyboard on a phone, and one input per
 * value means a paste error affects one line rather than mangling the list.
 *
 * The empty row is deliberate. A list field that starts with no inputs reads
 * as "nothing to do here", which is exactly the wrong impression for the field
 * that carries most of an author's credibility.
 */
export function StringListField({
  name,
  legend,
  description,
  values,
  onChange,
  placeholder,
  type = "url",
  addLabel = "Add another",
}: {
  name: string;
  legend: string;
  description?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  type?: "url" | "text";
  addLabel?: string;
}) {
  const descriptionId = useId();
  const list = useRef<HTMLUListElement | null>(null);
  const rows = values.length > 0 ? values : [""];

  /**
   * Focus is moved by querying the rendered list rather than by holding a ref
   * per input: the shared `Input` does not forward one, and the DOM order is
   * the same order as the array, so there is nothing extra to keep in step.
   */
  function focusRow(index: number) {
    queueMicrotask(() => list.current?.querySelectorAll("input")[index]?.focus());
  }

  function replace(index: number, value: string) {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  }

  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
    // Focus does not survive the removed input, so hand it to the row that
    // took its place — or to the one above, when the last row went.
    focusRow(Math.max(0, Math.min(index, next.length - 1)));
  }

  function add() {
    onChange([...rows, ""]);
    focusRow(rows.length);
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-[var(--color-ink)]">{legend}</legend>
      {description ? (
        <p id={descriptionId} className="text-xs text-[var(--color-ink-muted)]">
          {description}
        </p>
      ) : null}

      <ul ref={list} className="flex flex-col gap-1.5">
        {rows.map((value, index) => (
          // Index as key: these rows have no identity of their own, and a
          // value-based key would remount the input on every keystroke.
          <li key={index} className="flex items-center gap-1.5">
            <Input
              type={type}
              name={name}
              value={value}
              placeholder={placeholder}
              aria-label={`${legend}, ${index + 1}`}
              aria-describedby={description ? descriptionId : undefined}
              onChange={(event) => replace(index, event.currentTarget.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(index)}
              aria-label={`Remove ${legend.toLowerCase()} ${index + 1}`}
              disabled={rows.length === 1 && value.trim().length === 0}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <div>
        <Button variant="outline" size="sm" onClick={add}>
          {addLabel}
        </Button>
      </div>
    </fieldset>
  );
}
