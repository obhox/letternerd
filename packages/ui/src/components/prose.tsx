import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../cn";

export interface ProseProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children" | "dangerouslySetInnerHTML"> {
  /**
   * HTML from the content pipeline.
   *
   * It is already sanitised on the server by `rehype-sanitize`, against
   * `packages/content/src/sanitize-schema.ts`, before it is stored or sent
   * anywhere. Do not sanitise it again on the client: a second pass with a
   * general-purpose sanitiser strips exactly the `cms-*` classes and
   * `data-cms-qa` markers this component and the consuming site style on.
   */
  html?: string;
  /** Already-rendered nodes, for callers not going through the pipeline. */
  children?: ReactNode;
}

/**
 * Typography for rendered post HTML.
 *
 * The pipeline emits a small vocabulary of class names — `cms-figure`,
 * `cms-tldr`, `cms-takeaways`, `cms-faq`, `cms-howto`, `cms-embed`,
 * `cms-anchor-link` — and those names are a published contract that the
 * consuming site's stylesheet and the Speakable JSON-LD both select on. This
 * component only paints them; it never rewrites them.
 *
 * The rules live in `styles.css` under `.ui-prose` rather than in a wall of
 * `[&_.cms-faq\_\_question]:` arbitrary variants, because these are descendant
 * selectors over markup this file does not own — which is what a stylesheet is
 * for — and because the double-underscore names have to be escaped twice to
 * survive a Tailwind variant, which is how one of them silently stops matching.
 */
export function Prose({ html, children, className, ...props }: ProseProps) {
  if (html !== undefined) {
    return (
      <div
        className={cn("ui-prose", className)}
        dangerouslySetInnerHTML={{ __html: html }}
        {...props}
      />
    );
  }

  return (
    <div className={cn("ui-prose", className)} {...props}>
      {children}
    </div>
  );
}
