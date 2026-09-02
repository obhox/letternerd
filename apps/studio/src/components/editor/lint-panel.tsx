"use client";

import { CheckIcon, CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { Badge, Spinner, cn } from "@cms/ui";
import type { EditorFinding } from "./types";

/**
 * The editorial checks, grouped by what they actually do to you.
 *
 * The grouping is the point. Three rules refuse a publish — a missing image
 * alt, an FAQ answer that is absent from the visible body, and an unresolved
 * media reference — and everything else is advice. Heading hierarchy, thin
 * content, readability and metadata length are all warnings, and presenting
 * them as though they were gates teaches authors that the checks panel
 * exaggerates, which is how a real blocker gets ignored.
 *
 * Which findings block is decided on the server by `isBlocking`, next to the
 * gate that enforces it, and arrives here as a boolean. This component is not
 * allowed a second opinion.
 *
 * Colour never carries the status alone: each group has a heading in words, an
 * icon, and — for the blocking group — a sentence saying what it prevents.
 */

interface Group {
  id: string;
  heading: string;
  /** Says what the group does to a publish, in words rather than in red. */
  consequence: string;
  icon: typeof CircleAlertIcon;
  tone: string;
  border: string;
  findings: EditorFinding[];
}

function line(finding: EditorFinding): string | null {
  if (finding.line === null) return null;
  return finding.column === null
    ? `Line ${finding.line}`
    : `Line ${finding.line}, column ${finding.column}`;
}

/**
 * A finding, and — where it knows a line — a way to get there.
 *
 * "Line 42" is only useful to someone who can find line 42, and the editor
 * deliberately keeps its gutter off by default. Making the position a button
 * closes that gap: the check reports where the problem is, and the same words
 * put the caret on it.
 */
export function FindingList({
  findings,
  onGoToLine,
}: {
  findings: EditorFinding[];
  onGoToLine?: (line: number) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((finding, index) => {
        const position = line(finding);
        const at = finding.line;
        return (
          <li key={`${finding.rule}-${finding.line ?? "x"}-${index}`} className="text-sm">
            <p className="text-[var(--color-ink)]">{finding.message}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              <code className="font-[family-name:var(--font-mono)]">{finding.rule}</code>
              {position &&
                (onGoToLine && at !== null ? (
                  <button
                    type="button"
                    onClick={() => onGoToLine(at)}
                    className="ui-focus-ring rounded underline underline-offset-2 hover:text-[var(--color-ink)]"
                  >
                    {position}
                  </button>
                ) : (
                  <span>{position}</span>
                ))}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export interface LintPanelProps {
  findings: EditorFinding[];
  /** False until a render has come back; "clean" and "unchecked" are not the same. */
  checked: boolean;
  pending: boolean;
  /** Jumps the editor to a reported line. Omitted where there is no editor. */
  onGoToLine?: (line: number) => void;
  className?: string;
}

export function LintPanel({ findings, checked, pending, onGoToLine, className }: LintPanelProps) {
  const blocking = findings.filter((finding) => finding.blocks);
  const errors = findings.filter((finding) => finding.severity === "error" && !finding.blocks);
  const warnings = findings.filter((finding) => finding.severity === "warning");

  const groups: Group[] = [
    {
      id: "blocking",
      heading: "Blocks publishing",
      consequence: "Publishing is refused until these are fixed.",
      icon: CircleAlertIcon,
      tone: "text-[var(--color-danger)]",
      border: "border-[var(--color-danger)]",
      findings: blocking,
    },
    {
      id: "errors",
      heading: "Errors",
      consequence: "Serious, but they do not stop a publish.",
      icon: CircleAlertIcon,
      tone: "text-[var(--color-ink)]",
      border: "border-[var(--color-border)]",
      findings: errors,
    },
    {
      id: "warnings",
      heading: "Warnings",
      consequence: "Advice. None of these stops a publish.",
      icon: TriangleAlertIcon,
      tone: "text-[var(--color-warn)]",
      border: "border-[var(--color-border)]",
      findings: warnings,
    },
  ].filter((group) => group.findings.length > 0);

  return (
    <section
      aria-label="Editorial checks"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <h2 className="text-sm font-medium">Checks</h2>
        <div className="ml-auto flex items-center gap-2">
          {blocking.length > 0 && (
            <Badge variant="danger">
              {blocking.length} blocking {blocking.length === 1 ? "problem" : "problems"}
            </Badge>
          )}
          {warnings.length > 0 && <Badge variant="warning">{warnings.length} warnings</Badge>}
          {pending && <Spinner size="sm" label="Re-running checks" />}
        </div>
      </header>

      <div className="ui-scroll max-h-80 overflow-auto px-3 py-3">
        {!checked ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Not checked yet. Checks run with the preview.
          </p>
        ) : findings.length === 0 ? (
          // Silence would read as "not run". Say the check happened and passed.
          <p className="flex items-center gap-2 text-sm text-[var(--color-ok)]">
            <CheckIcon className="size-4" aria-hidden="true" />
            No issues. Nothing is blocking a publish.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.id} className={cn("border-l-2 pl-3", group.border)}>
                <h3
                  className={cn("flex items-center gap-1.5 text-sm font-semibold", group.tone)}
                >
                  <group.icon className="size-4" aria-hidden="true" />
                  {group.heading} ({group.findings.length})
                </h3>
                <p className="mt-0.5 mb-2 text-xs text-[var(--color-ink-muted)]">
                  {group.consequence}
                </p>
                <FindingList findings={group.findings} onGoToLine={onGoToLine} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
