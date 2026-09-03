/**
 * A line diff, so "restore" is a decision rather than a gamble.
 *
 * Two revisions of the same post look identical in a list: same title, same
 * author, timestamps a few minutes apart. Choosing between them by reading two
 * walls of markdown side by side is how the wrong number gets restored. What
 * an editor actually needs is the one question this answers — what changes if
 * I click this — so the diff is against the *current* body, not against the
 * neighbouring revision.
 *
 * Line-level rather than word-level on purpose. Markdown is edited in
 * paragraphs, a paragraph is a line, and an intraline diff of prose produces a
 * confetti of highlights that is harder to read than the paragraph itself.
 */

export type DiffKind = "added" | "removed" | "context";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the two bodies are identical — worth saying out loud. */
  identical: boolean;
  /**
   * Set when the pair was too large to diff and `lines` is empty. The screen
   * falls back to showing the revision body on its own rather than blocking.
   */
  tooLarge: boolean;
}

/**
 * Above this the quadratic table stops being free.
 *
 * 1200 lines each is roughly a 1.4M-cell table — still milliseconds, but the
 * ceiling exists so a pathological document cannot make the history page the
 * slowest screen in the studio.
 */
const MAX_LINES = 1200;

function splitLines(value: string): string[] {
  // A trailing newline is not a line; without this every diff reports a
  // spurious empty change at the end.
  const normalised = value.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalised.length === 0 ? [] : normalised.split("\n");
}

/**
 * Longest common subsequence, walked back into a change list.
 *
 * The whole table is built rather than a banded approximation: the inputs are
 * bounded above, and an approximate diff that occasionally invents a change is
 * exactly the thing that would make someone distrust this screen.
 */
export function diffLines(before: string, after: string): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return { lines: [], added: 0, removed: 0, identical: before === after, tooLarge: true };
  }

  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "context", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "removed", text: a[i]! });
      removed++;
      i++;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      added++;
      j++;
    }
  }
  while (i < a.length) {
    lines.push({ kind: "removed", text: a[i]! });
    removed++;
    i++;
  }
  while (j < b.length) {
    lines.push({ kind: "added", text: b[j]! });
    added++;
    j++;
  }

  return { lines, added, removed, identical: added === 0 && removed === 0, tooLarge: false };
}

/**
 * Drop long runs of unchanged lines, keeping a few for orientation.
 *
 * A one-word fix to a 2,000-word post is otherwise 200 identical lines around
 * two changed ones, and the changed ones are the reason anyone opened this.
 */
export function collapseContext(lines: DiffLine[], keep = 3): Array<DiffLine | { kind: "gap"; skipped: number }> {
  const out: Array<DiffLine | { kind: "gap"; skipped: number }> = [];
  let run: DiffLine[] = [];

  const flush = (atEnd: boolean) => {
    if (run.length === 0) return;
    const head = out.length === 0 ? 0 : keep;
    const tail = atEnd ? 0 : keep;

    if (run.length <= head + tail) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, head));
      out.push({ kind: "gap", skipped: run.length - head - tail });
      if (tail > 0) out.push(...run.slice(run.length - tail));
    }
    run = [];
  };

  for (const line of lines) {
    if (line.kind === "context") {
      run.push(line);
      continue;
    }
    flush(false);
    out.push(line);
  }
  flush(true);

  return out;
}
