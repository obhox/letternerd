/**
 * Class strings shared by the three auth forms.
 *
 * Not a component library — `@cms/ui` is that, and these screens deliberately
 * do not depend on it. They are the pages that have to render when the rest of
 * the studio cannot: before a session exists, before a site is chosen, and
 * during whatever went wrong that made someone sign in again. The fewer moving
 * parts between the user and a password field, the better.
 *
 * Colours are token references only. The tokens in `globals.css` already carry
 * their own dark-mode values, so a hardcoded colour here would be a shade that
 * follows the theme in every other part of the app and stops following it in
 * this one.
 */

export const card =
  "w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm";

export const heading = "text-lg font-semibold text-[var(--color-ink)]";

export const subheading = "mt-1 text-sm text-[var(--color-ink-muted)]";

export const label = "block text-sm font-medium text-[var(--color-ink)]";

/**
 * The focus ring is not decoration. These forms are frequently completed from
 * a password manager, which means tabbing between fields, which means the ring
 * is the only indication of where the keyboard currently is.
 */
export const input =
  "mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 " +
  "text-sm text-[var(--color-ink)] outline-none " +
  "focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export const hint = "mt-1 text-xs text-[var(--color-ink-muted)]";

export const button =
  "block w-full text-center rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] " +
  "outline-none transition-opacity hover:opacity-90 " +
  "focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButton =
  "block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-center " +
  "text-sm font-medium text-[var(--color-ink)] outline-none transition-colors " +
  "hover:bg-[var(--color-muted)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * Errors are bordered and tinted rather than merely red text: a colour-only
 * signal is invisible to a good fraction of the people who will read it, and
 * this is the element that explains why they cannot get in.
 */
export const alert =
  "mt-4 rounded-md border border-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-2 " +
  "text-sm text-[var(--color-danger)]";

export const notice =
  "mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 " +
  "text-sm text-[var(--color-ink)]";

export const link =
  "rounded-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline " +
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

export const footnote = "mt-6 text-center text-sm text-[var(--color-ink-muted)]";
