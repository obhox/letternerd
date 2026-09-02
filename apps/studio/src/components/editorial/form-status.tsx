import type { EditorialState } from "./action-state";

/**
 * The three things a submitted form can have to say.
 *
 * An error is `role="alert"`: it arrives after the submit, the person's focus
 * has moved on, and without the live region they would have to go looking for
 * it. A warning is `role="status"` — the save worked, and interrupting for
 * something that is not a failure trains people to ignore the interruption.
 */
export function FormStatus({ state }: { state: EditorialState }) {
  return (
    <>
      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--color-surface))] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.warnings.length > 0 ? (
        <div
          role="status"
          className="rounded-md border border-[var(--color-warn)] bg-[color-mix(in_oklch,var(--color-warn)_12%,var(--color-surface))] px-3 py-2 text-sm text-[var(--color-ink)]"
        >
          <p className="font-medium">Saved, with something worth checking</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.message && state.warnings.length === 0 ? (
        <p role="status" className="text-sm text-[var(--color-ok)]">
          {state.message}
        </p>
      ) : null}
    </>
  );
}
