import { CodeBlock } from "./code-block";
import { postUrl, verificationChecks, type InstallValues } from "./snippets";

/**
 * The section that justifies the page.
 *
 * A README can tell someone what to do. It cannot tell them whether it worked,
 * because it does not know their domain — so every command here is addressed to
 * the consuming site, with its real origin and a slug that really is published,
 * and every one of them says what a failure *means*. "The sitemap 404s" is a
 * symptom; "the route file is missing, and in the app router the folder name is
 * the URL" is the fix.
 *
 * Seven checks, in the order a broken install usually breaks. The first is the
 * premise — content in the HTML with no JavaScript — and if it fails the rest
 * are noise.
 */
export function VerifySection({ values }: { values: InstallValues }) {
  const checks = verificationChecks(values);

  return (
    <section
      id="verify"
      aria-labelledby="verify-heading"
      className="border-t border-[var(--color-border)] pt-6"
    >
      <div className="flex items-baseline gap-2.5">
        <span
          aria-hidden="true"
          className="font-mono text-xs text-[var(--color-ink-faint)] tabular-nums"
        >
          08
        </span>
        <h2
          id="verify-heading"
          className="text-lg font-semibold tracking-tight text-[var(--color-ink)]"
        >
          Check it worked
        </h2>
      </div>

      <div className="mt-2 sm:pl-[1.9rem]">
        <p className="max-w-2xl text-sm text-[var(--color-ink-secondary)]">
          Run these against{" "}
          <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-xs text-[var(--color-ink)]">
            {values.baseUrl}
          </code>{" "}
          after you deploy. They are already pointed at your domain and at a real post
          {values.sampleSlug === null ? (
            <>
              {" "}
              — except that nothing is published on this site yet, so{" "}
              <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-xs text-[var(--color-ink)]">
                your-post-slug
              </code>{" "}
              is a stand-in. Publish something first, then substitute its slug.
            </>
          ) : (
            <>
              {" "}
              of yours,{" "}
              <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-xs text-[var(--color-ink)]">
                {postUrl(values)}
              </code>
              .
            </>
          )}
        </p>

        <ol className="mt-4 flex list-none flex-col gap-6 p-0">
          {checks.map((check, index) => (
            <li key={check.id}>
              <h3 className="text-md font-semibold text-[var(--color-ink)]">
                <span aria-hidden="true" className="text-[var(--color-ink-faint)]">
                  {index + 1}.{" "}
                </span>
                {check.title}
              </h3>
              <CodeBlock label="terminal" describedAs={check.title} code={check.command} />
              <dl className="max-w-2xl text-sm">
                <dt className="font-medium text-[var(--color-ink)]">Expect</dt>
                <dd className="mt-0.5 text-[var(--color-ink-secondary)]">{check.expect}</dd>
                <dt className="mt-2 font-medium text-[var(--color-ink)]">If it does not</dt>
                <dd className="mt-0.5 text-[var(--color-ink-secondary)]">{check.failure}</dd>
              </dl>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
