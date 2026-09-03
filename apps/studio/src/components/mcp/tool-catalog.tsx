import type { ToolSummary } from "@/app/api/mcp/catalog";

/**
 * The tool list, grouped.
 *
 * Someone deciding whether to hand an agent a key to their site is deciding
 * what that agent can do, and "41 tools" is not an answer to that. The names
 * are the answer: `publish_document` and `delete_media` read very differently
 * from `list_documents`, and they should be visible before the key is created
 * rather than discovered afterwards.
 *
 * Writes are marked and reads are not. In a monotone system a badge on every
 * row is noise; a badge on the rows that can change something is a scan path.
 * The tools no API key can reach at all are marked instead — an agent will see
 * them listed and be refused, and that is easier to accept when it was on the
 * page beforehand.
 */

/** Section order, chosen so the content tools a reader cares about come first. */
const GROUP_ORDER = [
  "Documents",
  "Media",
  "Taxonomy",
  "Authors",
  "Redirects",
  "Rendering",
  "Scheduling",
  "Insights",
  "Site",
  "Settings",
  "Other",
];

function byGroup(tools: ToolSummary[]): [string, ToolSummary[]][] {
  const groups = new Map<string, ToolSummary[]>();
  for (const tool of tools) {
    const bucket = groups.get(tool.group);
    if (bucket) bucket.push(tool);
    else groups.set(tool.group, [tool]);
  }
  return [...groups.entries()].sort(
    // An unlisted group sorts last rather than disappearing: a new capability
    // whose section nobody has labelled yet must still show up on this screen.
    (a, b) =>
      (GROUP_ORDER.indexOf(a[0]) + 1 || GROUP_ORDER.length + 1) -
      (GROUP_ORDER.indexOf(b[0]) + 1 || GROUP_ORDER.length + 1),
  );
}

export function ToolCatalog({ tools }: { tools: ToolSummary[] }) {
  const groups = byGroup(tools);
  const reachable = tools.filter((tool) => tool.keyReachable);
  const writeCount = reachable.filter((tool) => !tool.readOnly).length;
  const sessionOnly = tools.length - reachable.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--color-ink-secondary)]">
        {tools.length} tools. {writeCount} of them change this site&rsquo;s content and an admin key
        can call them. {sessionOnly} administer the site and no API key can: a client sees them
        listed and is refused when it calls one.
      </p>

      {groups.map(([group, entries]) => (
        <section key={group} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
            {group}
            <span className="ml-2 font-normal normal-case">{entries.length}</span>
          </h3>
          <dl className="flex flex-col divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            {entries.map((tool) => (
              <div
                key={tool.name}
                className="grid gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[18rem_1fr]"
              >
                {/* The badge wraps under a long name rather than breaking it:
                    a tool name split across two lines is no longer a token
                    anyone can search for or paste. */}
                <dt className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <code className="font-mono text-xs whitespace-nowrap text-[var(--color-ink)]">
                    {tool.name}
                  </code>
                  {/* One marker at most. "No key can call this" is the more
                      important fact about a tool that is also a write. */}
                  {!tool.keyReachable ? (
                    <span className="shrink-0 rounded border border-[var(--color-border-strong)] px-1 text-[10px] leading-4 tracking-wide text-[var(--color-ink-secondary)] uppercase">
                      owner only
                    </span>
                  ) : (
                    !tool.readOnly && (
                      <span className="shrink-0 rounded border border-[var(--color-border-strong)] px-1 text-[10px] leading-4 tracking-wide text-[var(--color-ink-secondary)] uppercase">
                        write
                      </span>
                    )
                  )}
                </dt>
                <dd className="min-w-0 text-sm text-[var(--color-ink-secondary)]">
                  {tool.summary}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
