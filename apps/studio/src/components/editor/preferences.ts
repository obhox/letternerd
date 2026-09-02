"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The handful of choices the editor remembers between sessions.
 *
 * All of them are layout preferences — which panes are showing, whether the
 * gutter is on. None of them is content, and none of them is authority: if the
 * store is unreadable the editor opens with its defaults and works exactly as
 * well.
 *
 * Every access is wrapped, because `localStorage` is not a plain object.
 * Reading it throws outright in a browser configured to block site data and in
 * a cross-origin iframe, and writing it throws when the origin's quota is
 * full. An unguarded read here would take the whole editor down at mount —
 * losing an author their draft over a preference about pane widths — which is
 * an absurd trade and the reason for the try/catch on both sides.
 */

const PREFIX = "cms.studio.editor.";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // A preference that cannot be persisted is still a preference for this
    // session. There is nothing to tell the author and nothing to retry.
  }
}

/**
 * A remembered choice from a fixed set.
 *
 * The stored value is applied in an effect rather than read during the first
 * render on purpose. The server renders this screen too, and it has no
 * `localStorage`; reading it while rendering would produce markup that does
 * not match what the server sent and React would discard the tree. So the
 * first paint is the default, and the remembered value arrives immediately
 * after mount.
 */
export function useRemembered<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    const stored = read(key);
    if (stored !== null && (allowed as readonly string[]).includes(stored)) {
      setValue(stored as T);
    }
    // `allowed` is a module-level constant at every call site; listing it
    // would re-run this on every render and fight the author's own changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const choose = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );

  return [value, choose];
}

/** A remembered on/off, stored as the strings the set above accepts. */
export function useRememberedFlag(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [value, choose] = useRemembered<"on" | "off">(
    key,
    ["on", "off"],
    fallback ? "on" : "off",
  );
  return [value === "on", (next: boolean) => choose(next ? "on" : "off")];
}
