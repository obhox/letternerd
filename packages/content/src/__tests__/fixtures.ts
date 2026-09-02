/**
 * Shared fixtures.
 *
 * The article below is deliberately one document that exercises every feature
 * at once, because that is how real posts arrive: a `:::faq` that renders
 * correctly on its own but collides with the heading above it is exactly the
 * bug an isolated test never sees.
 */

import type { RenderInput, RenderSiteContext, ResolvedMedia } from "../types";

export const site: RenderSiteContext = {
  baseUrl: "https://spendtab.com",
  blogBasePath: "/blog",
  locale: "en-GB",
};

const ASSETS: Record<string, ResolvedMedia> = {
  "asset-chart": {
    id: "asset-chart",
    alt: "Monthly recurring revenue climbing through the year",
    caption: "MRR, January to December.",
    width: 1600,
    height: 900,
    blurhash: "LEHV6nWB2yk8pyo0adR*",
    src: "https://cdn.spendtab.com/asset-chart/1600.webp",
    variants: [
      { url: "https://cdn.spendtab.com/asset-chart/640.webp", width: 640, format: "webp" },
      { url: "https://cdn.spendtab.com/asset-chart/320.webp", width: 320, format: "webp" },
      { url: "https://cdn.spendtab.com/asset-chart/1600.webp", width: 1600, format: "webp" },
    ],
  },
  "asset-logo": {
    id: "asset-logo",
    alt: null,
    width: 200,
    height: 60,
    src: "https://cdn.spendtab.com/asset-logo/200.png",
    variants: [],
  },
};

export function resolveMedia(id: string): ResolvedMedia | undefined {
  return ASSETS[id];
}

export const ARTICLE = `---
internalNote: do not publish this line
---

:::tldr
Expense categories should mirror your chart of accounts, not your team's habits.
:::

:::takeaways
- Map every category to a general-ledger code before you invite anyone.
- Rename categories in the CMS, never in the accounting system.
- Review unmapped spend once a month.
:::

## Why categories drift

Teams invent categories faster than finance can reconcile them. A category that
exists only in the expense tool is a category the ledger cannot see, and the
month-end difference has to be explained by hand.

![Monthly recurring revenue](media://asset-chart)

Read the [pricing page](/pricing) or the [previous post](./chart-of-accounts).

### Mapping to the ledger

Every category carries a general-ledger code. Set it once.

\`\`\`ts
const category = { name: "Software", ledgerCode: "6820" };
\`\`\`

:::faq
### Can I rename a category later?

Yes. Renaming a category does not change its ledger code, so historical
reports stay correct.

### What happens to unmapped spend?

It lands in a suspense category and appears in the monthly review until
somebody assigns it a code.
:::

:::howto[Set up your first category]
::step[Open Settings, then Categories.]
::step[Enter a name and a general-ledger code.]
::step[Invite your team once every code is mapped.]
:::

::embed{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
`;

export function articleInput(over: Partial<RenderInput> = {}): RenderInput {
  return {
    markdown: ARTICLE,
    slug: "expense-categories",
    site,
    resolveMedia,
    publicFrontmatter: {
      title: "How to structure expense categories that finance will accept",
      description:
        "Expense categories drift the moment a team invents one. Map every category to a general-ledger code first, and month-end stops being a negotiation.",
      canonical: "https://spendtab.com/blog/expense-categories",
      datePublished: "2026-01-14",
    },
    ...over,
  };
}
