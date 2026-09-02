import { PlugZapIcon, TriangleAlertIcon } from "lucide-react";
import { RULE_LABELS, type CoverageView } from "./types";

/**
 * What this screen could not check, said before anything it did.
 *
 * The failure this exists to prevent is the quiet one. With no analytics
 * provider connected, half the rules never run — and a short list of findings
 * then reads exactly like a healthy site. An editor who trusts it stops
 * looking, which is a worse outcome than an empty screen, because an empty
 * screen at least prompts a question.
 *
 * So: no empty charts, no zeroes standing in for unmeasured metrics, and the
 * skipped rules named individually rather than summarised as "limited data".
 */
export function ProviderNotice({ coverage }: { coverage: CoverageView }) {
  if (coverage.complete) return null;

  const skipped = coverage.rules.filter((rule) => !rule.ran);
  const hobbled = coverage.rules.filter((rule) => rule.ran && rule.limitation !== null);
  const providerFailed = coverage.provider?.error != null;

  return (
    <section
      role="status"
      className="rounded-lg border border-[var(--color-warn)] bg-[color-mix(in_oklch,var(--color-warn)_10%,var(--color-surface))] p-4"
    >
      <div className="flex items-start gap-3">
        {providerFailed ? (
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
        ) : (
          <PlugZapIcon className="mt-0.5 size-5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">
            {providerFailed
              ? "This site's analytics provider could not be reached"
              : "This is a partial check, not a clean bill of health"}
          </h2>

          <p className="mt-1 text-sm text-[var(--color-ink)]">
            {providerFailed ? (
              <>
                {coverage.provider?.error} Until it is reconnected, the rules below were not
                evaluated at all — an empty list here is not evidence that anything is fine.
              </>
            ) : (
              <>
                No search or audience analytics provider is connected to this site, so there are no
                impressions, clicks, click-through rates or ranking positions to judge anything
                against. {coverage.documentsAnalysed} published{" "}
                {coverage.documentsAnalysed === 1 ? "document was" : "documents were"} checked
                against the rules that need only this system's own data.
              </>
            )}
          </p>

          {skipped.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                Not checked
              </h3>
              <ul className="mt-1 space-y-1 text-sm text-[var(--color-ink)]">
                {skipped.map((rule) => (
                  <li key={rule.kind} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong className="font-medium">{RULE_LABELS[rule.kind] ?? rule.kind}</strong>
                      {rule.limitation ? ` — ${rule.limitation}` : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hobbled.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                Checked, but could not conclude
              </h3>
              <ul className="mt-1 space-y-1 text-sm text-[var(--color-ink)]">
                {hobbled.map((rule) => (
                  <li key={rule.kind} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span>
                      <strong className="font-medium">{RULE_LABELS[rule.kind] ?? rule.kind}</strong>
                      {rule.limitation ? ` — ${rule.limitation}` : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!providerFailed && (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              Connecting Google Search Console would turn those back on: which queries already show
              this site, which pages rank just below page one, which titles are losing the click,
              and which posts have started sliding. There is nowhere to store those credentials
              yet — the connection is not built.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
