"use client";

import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Button, Kbd } from "@cms/ui";
import { BLOCK_COMMANDS, INLINE_COMMANDS, STRUCTURE_COMMANDS } from "./snippets";

/**
 * The shortcuts, written down where they can be found.
 *
 * An editor's keyboard layer is only worth having if it is discoverable, and
 * the two places people look are the tooltip on the button and a list they can
 * open. Both are generated from the same command table the keymap is built
 * from, so a binding cannot be documented here and absent from the editor, or
 * the reverse.
 */

/**
 * `Mod` is Cmd on Apple hardware and Ctrl everywhere else — the same rule
 * CodeMirror's own key parser applies, so the label matches the binding.
 *
 * Resolved after mount rather than during render: the server has no navigator,
 * and a platform-dependent string in the first paint is a hydration mismatch.
 * The first frame says Ctrl; the effect corrects it immediately.
 */
export function useModLabel(): string {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
      navigator.platform ??
      "";
    if (/mac|iphone|ipad|ipod/i.test(`${platform} ${navigator.userAgent}`)) setMod("⌘");
  }, []);
  return mod;
}

/** "Mod-Shift-8" becomes "⌘⇧8" or "Ctrl+Shift+8". */
export function formatShortcut(key: string, mod: string): string {
  const symbolic = mod === "⌘";
  const parts = key.split("-").map((part) => {
    if (part === "Mod") return mod;
    if (part === "Shift") return symbolic ? "⇧" : "Shift";
    if (part === "Alt") return symbolic ? "⌥" : "Alt";
    if (part.length === 1) return part.toUpperCase();
    return part;
  });
  return parts.join(symbolic ? "" : "+");
}

/** A tooltip that says what the button does and how to do it without one. */
export function commandHint(title: string, key: string | undefined, mod: string): string {
  return key ? `${title} — ${formatShortcut(key, mod)}` : title;
}

interface Entry {
  keys: string;
  what: string;
}

interface Group {
  heading: string;
  entries: Entry[];
}

function groups(mod: string): Group[] {
  const fromCommands = (list: typeof INLINE_COMMANDS): Entry[] =>
    list.flatMap((command) =>
      command.key ? [{ keys: formatShortcut(command.key, mod), what: command.label }] : [],
    );

  return [
    {
      heading: "Document",
      entries: [
        { keys: formatShortcut("Mod-s", mod), what: "Save now" },
        { keys: formatShortcut("Mod-f", mod), what: "Find and replace" },
        { keys: formatShortcut("Mod-z", mod), what: "Undo" },
        { keys: formatShortcut("Mod-Shift-z", mod), what: "Redo" },
        { keys: "Esc", what: "Leave the editor without a mouse" },
      ],
    },
    { heading: "Text", entries: fromCommands(INLINE_COMMANDS) },
    { heading: "Structure", entries: fromCommands(STRUCTURE_COMMANDS) },
    {
      heading: "Blocks",
      entries: [
        { keys: "/", what: `Block menu — ${BLOCK_COMMANDS.map((c) => c.label).join(", ")}` },
        { keys: "Enter", what: "Continues the list or quote you are in" },
        { keys: "Backspace", what: "Removes the marker before the text" },
      ],
    },
    {
      heading: "Images",
      entries: [
        { keys: "Paste", what: "Uploads the image and asks for alt text" },
        { keys: "Drop", what: "Same, at the point you drop it" },
      ],
    },
  ];
}

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const mod = useModLabel();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus moves into the sheet so Escape reaches it and Tab walks its contents
  // rather than continuing from whatever opened it.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      className="ui-scroll absolute right-2 bottom-9 z-20 max-h-[70%] w-72 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-overlay)]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto"
          aria-label="Close the shortcut list"
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>

      {groups(mod).map((group) => (
        <section key={group.heading} className="mb-3 last:mb-0">
          <h3 className="mb-1 text-2xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            {group.heading}
          </h3>
          <dl className="flex flex-col gap-1">
            {group.entries.map((entry) => (
              <div key={`${group.heading}-${entry.keys}-${entry.what}`} className="flex gap-2">
                <dt className="shrink-0">
                  <Kbd>{entry.keys}</Kbd>
                </dt>
                <dd className="min-w-0 flex-1 text-xs text-[var(--color-ink-secondary)]">
                  {entry.what}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
