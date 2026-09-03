import type { DocumentFixture } from "./types";

/**
 * The Acme corpus: sixteen posts, three pages and two blocks.
 *
 * Written as prose a finance-software company would actually publish, because
 * the editor, the preview and the public renderer all show the body and there
 * is no way to photograph any of them convincingly over placeholder text. The
 * authoring directives are spread deliberately rather than uniformly — `:::faq`
 * on four posts, `:::howto` on two, tables and code where the subject calls for
 * them — so that the Checks panel, the outline and the structured-data surfaces
 * each have something real to display, and so that not every post looks the
 * same in the list.
 *
 * Two conventions run through the bodies.
 *
 * `{{media:slot}}` is a placeholder the seeder rewrites into `media://<uuid>`
 * once the asset exists. A fixture cannot know an id that has not been minted.
 *
 * Bodies start at H2. The document title is the page's only H1, and an H1 here
 * would trip `heading-hierarchy` on every post — a warning that would be
 * entirely our own fault and would teach anyone reading the Checks panel to
 * ignore it.
 */

/* ------------------------------------------------------------------ */
/* Published posts                                                     */
/* ------------------------------------------------------------------ */

const expensePolicy: DocumentFixture = {
  type: "post",
  slug: "expense-policy-that-people-actually-follow",
  title: "How to write an expense policy people follow",
  description:
    "Most expense policies fail because they are written for the auditor. Cut yours to six decisions, put a number on each, and let software do the rest.",
  author: "maya",
  reviewer: "priya",
  category: "guides",
  tags: ["expense-policy", "approvals", "reimbursements"],
  entities: [
    { key: "expense-management", salience: 0.9, primary: true },
    { key: "internal-control", salience: 0.55 },
  ],
  cover: "coverExpensePolicy",
  state: { kind: "published", publishedAt: "2025-11-12T09:00:00.000Z" },
  bodyMd: `:::tldr
An expense policy fails when it is written for the auditor rather than for the person holding the card. Reduce it to the six decisions people make in the moment, attach a number to each one, and move enforcement into the tooling so nobody has to memorise anything.
:::

## The document nobody reads

Every finance team has a policy PDF. Almost nobody outside finance has read it. That is not a discipline problem — it is a design problem. The average policy runs to fourteen pages because it was written to survive a question from an auditor, and the person who wants to know whether they can expense a £9 airport sandwich will not read fourteen pages to find out.

The test for a policy is not whether it is complete. It is whether an employee standing at a till can predict the outcome. If they cannot, they will guess, and half the guesses will be wrong in ways you only discover at [month-end close](/blog/month-end-close-checklist).

## The six decisions

Almost all real spending questions collapse into six:

1. Can I buy this at all?
2. How much can I spend without asking?
3. Who do I ask when it is more than that?
4. Do I need a receipt?
5. What happens if I get it wrong?
6. How do I get my money back?

A policy that answers these six clearly, with numbers, will outperform one that enumerates categories nobody remembers. Everything else — the category tree, the accounting treatment, the tax positions — belongs in the finance team's own documentation, not in the document you ask four hundred people to read.

![Abstract cover graphic for the Acme expense policy guide]({{media:coverExpensePolicy}})

## Put a number next to every rule

"Reasonable" is not a policy. It is a request that each employee invent their own, and it guarantees that the most cautious people underspend while the least cautious set the ceiling.

Replace every qualitative word with a threshold. Not "modest hotels" but "£180 a night in London, £120 elsewhere in the UK, or anything at all if the alternative is a 6am flight." Not "reasonable client entertainment" but "£60 a head, and name the client in the memo." The numbers will be wrong at first. That is fine — a wrong number gets corrected in one line, whereas a vague sentence gets litigated in Slack every week for a year.

## Enforce in the tool, not in the document

The policy people follow is the one their card enforces. If the limit is £75, the card should decline at £76 and tell the holder why, in the notification, at the till. If a category is out of policy, the transaction should still go through and then land in a review queue — declining a legitimate purchase in front of a customer costs more than the purchase.

This is the practical argument for card-first spending over reimbursement: a control you apply before the money moves is a control; a control you apply afterwards is a conversation. We wrote about the trade-off in more detail in [corporate cards versus reimbursements](/blog/corporate-cards-vs-reimbursements).

## Publish the exceptions

Every policy has exceptions, and pretending otherwise is what makes people stop trusting it. Keep a visible, dated list: who asked, what for, what was decided. Two things happen. People stop asking questions already answered, and finance stops making the same call twice with different answers depending on who is on holiday.

:::takeaways
- Write the policy for the person at the till, not for the auditor.
- Replace every qualitative word with a number, even a provisional one.
- Enforce limits in the card and the approval routing, not in a PDF.
- Keep a public, dated exceptions log so decisions stay consistent.
:::

## Review it twice a year, in public

A policy revised annually behind closed doors is a policy that drifts out of step with how the company actually operates. Put a recurring half-hour in the calendar, invite the three people who submit the most expenses, and change one thing. Announce what changed and why. A policy with visible authorship and a changelog is treated as a live document; an unsigned PDF is treated as furniture.

:::faq
### How long should an expense policy be?

One page for the rules people need in the moment, plus an appendix for finance. If the part employees are expected to read runs past a single screen, it will not be read, and the length is buying you nothing.

### Should we require receipts for every purchase?

No. Set a receipt threshold — most teams land between £20 and £75 — and require one above it. Below the threshold the receipt costs more in chasing than it protects, and a card statement line is already evidence that the money moved.

### What is the fastest way to make a policy stick?

Move enforcement into the card and the approval route so that following the policy is the path of least resistance. A rule the tool applies needs no memorisation, and a rule nobody has to memorise is a rule nobody breaks by accident.
:::
`,
};

const closeChecklist: DocumentFixture = {
  type: "post",
  slug: "month-end-close-checklist",
  title: "A month-end close checklist for lean teams",
  description:
    "A five-day close is a sequencing problem, not a staffing one. Here is the order of operations that gets a small finance team from period end to sign-off.",
  author: "priya",
  reviewer: "maya",
  category: "guides",
  tags: ["month-end-close", "accounts-payable", "audit"],
  entities: [
    { key: "accounting", salience: 0.85, primary: true },
    { key: "gaap", salience: 0.5 },
  ],
  cover: "chartCloseCycle",
  state: { kind: "published", publishedAt: "2025-12-04T08:30:00.000Z" },
  bodyMd: `:::tldr
A slow close is almost never a staffing problem. It is a sequencing problem: the team is waiting on inputs that could have been collected during the month. Front-load the collection, fix the order of operations, and a nine-day close becomes a four-day close without hiring anyone.
:::

## Why the close takes nine days

Ask a controller why the close takes as long as it does and the answer is rarely "the work is hard". It is that on day two they are waiting for card receipts, on day four they are waiting for a vendor invoice, and on day six they are waiting for a budget owner to confirm what a £14,000 line was for. None of that waiting is accounting work. All of it could have happened three weeks earlier.

![Bar chart showing days to close falling from nine days to four across a year]({{media:chartCloseCycle}})

## The order of operations

:::howto[The five-day close]
::step[Cut off card spend at period end and freeze the feed, so the population you are reconciling stops moving.]
::step[Chase receipts automatically during the month, not after it. Anything still missing on day one is an exception, not the norm.]
::step[Post accruals for known-but-uninvoiced spend from the commitments you already hold — purchase orders, signed contracts, approved requisitions.]
::step[Reconcile the card and bank accounts, then the intercompany balances, then the balance sheet accounts in materiality order.]
::step[Review flux against prior month and budget, write the commentary, and get the sign-off in the same session rather than in a follow-up.]
:::

The sequence matters more than any single item on it. Reconciling before accruals means reconciling twice. Writing commentary before the flux review means writing it twice. Most of the days a slow close spends are spent redoing work that was done too early.

## Collect during the month

The single largest lever is moving receipt collection out of the close window. If a card transaction arrives with its receipt attached and its category coded on the day it happens, day one of the close starts with a complete population instead of a chase list.

That is a tooling question rather than a policy question, and it is the reason we build [receipt matching](/blog/how-receipt-matching-works) into the card notification rather than into a month-end reminder email.

## Accrue from commitments, not from memory

The other large lever is accruals. Most teams build them from a spreadsheet somebody maintains by hand, which is why they are late and why they are the first thing an auditor samples. If you already hold the approved purchase orders and signed contracts, the accrual is a query, not a recollection. We go through the mechanics in [accruals without the spreadsheet](/blog/accruals-without-the-spreadsheet).

## Materiality, not completeness

A lean team cannot reconcile everything to the penny and should not try. Rank the balance sheet accounts by absolute balance and by volatility, reconcile the top decile properly every month, and put the rest on a quarterly rotation with a variance trigger. Document the threshold. An auditor will accept a stated, consistently applied materiality policy far more readily than an unstated one that happens to be thorough this quarter.

:::takeaways
- Freeze the population first; everything downstream depends on it not moving.
- Move receipt collection into the month, where it costs minutes rather than days.
- Build accruals from commitments you already hold, not from a maintained spreadsheet.
- Reconcile in materiality order and write the threshold down.
:::

:::faq
### What is a realistic close time for a 40-person company?

Four to five working days, assuming card spend is captured with receipts during the month and accruals come from commitment data. Nine days is common but is almost always a sequencing problem rather than a resourcing one.

### Should we close the books before or after the bank reconciliation?

Reconcile the bank and card accounts after posting accruals but before the flux review. Doing it earlier means doing it again, because accrual postings change the balances you just tied out.
:::
`,
};

const cardsVsReimbursements: DocumentFixture = {
  type: "post",
  slug: "corporate-cards-vs-reimbursements",
  /**
   * The rename. It went live under the singular and was corrected afterwards,
   * which is exactly the case `slug_history` exists for — an inbound link from
   * before the fix must keep resolving.
   */
  previousSlug: "corporate-cards-vs-reimbursement",
  title: "Corporate cards vs reimbursements: how to choose",
  description:
    "Cards move the control before the spend; reimbursements move it after. Which one fits depends on headcount, cash position and how much chasing you can bear.",
  author: "maya",
  category: "guides",
  tags: ["corporate-cards", "reimbursements", "expense-policy"],
  entities: [
    { key: "corporate-card", salience: 0.9, primary: true },
    { key: "expense-management", salience: 0.6 },
  ],
  state: { kind: "published", publishedAt: "2026-01-15T10:00:00.000Z" },
  bodyMd: `:::tldr
A corporate card applies the control before the money moves. A reimbursement applies it afterwards, and by then the only lever left is a conversation. Cards win on control and on employee experience; reimbursements win on float and on simplicity at very small headcounts.
:::

## The real difference

The debate is usually framed as a cost question. It is not. The difference is when the control lands.

With a card, the limit, the merchant category and the approval threshold are evaluated at authorisation. Something out of policy either declines or lands in a queue with the transaction attached. With a reimbursement, the employee has already spent their own money, and refusing the claim means telling someone they are personally out of pocket for a decision they made in good faith. Very few managers will do that, which means the control does not really exist.

## Where each one fits

| | Corporate cards | Reimbursements |
| --- | --- | --- |
| Control applied | At authorisation | After the spend |
| Employee cash exposure | None | Full, until paid |
| Working capital | Company float, settled monthly | Employee float, settled on claim |
| Setup effort | Card programme, limits, KYC | Almost none |
| Best for | Recurring, predictable spend | Rare, one-off, or contractors |
| Failure mode | Unreconciled spend | Unclaimed spend and slow payback |

The row that decides it for most teams is the second one. Asking a graduate hire to float £600 of travel for six weeks is a retention problem long before it is a finance problem.

## Do not choose only one

The useful answer for almost every company past about thirty people is both, with a clear rule about which applies. Cards for anything recurring or foreseeable: software, travel, client entertainment, supplies. Reimbursements for the genuinely rare — a contractor's mileage, a one-off purchase by someone with no card, the taxi somebody took at 2am because the last train was cancelled.

Write the rule down in the [expense policy](/blog/expense-policy-that-people-actually-follow) and make it the first line. "If you have a card, use the card" removes more ambiguity than any category list.

## The cost most teams forget

Card programmes look expensive because the interchange rebate and the annual fee are visible. Reimbursements look cheap because their cost is distributed: the hour an employee spends assembling a claim, the hour a manager spends approving it, the days finance spends chasing receipts for spend that already happened, and the reconciliation work at [month-end](/blog/month-end-close-checklist) for a population nobody has coded.

Price both properly and the card programme is usually cheaper by a wide margin at any headcount above about twenty-five.

:::takeaways
- Cards apply control before the money moves; reimbursements apply it after, when it is mostly theoretical.
- Employee cash exposure is the deciding factor more often than programme cost.
- Run both, with one unambiguous rule about which applies.
- Cost reimbursements honestly and the card programme usually wins outright.
:::

:::faq
### At what headcount does a card programme start to make sense?

Around twenty-five people, or earlier if you have frequent travel. Below that the administrative overhead of issuing and limiting cards outweighs the reconciliation savings, and a small reimbursement queue is genuinely manageable.

### Can we give cards to contractors?

Usually yes for the card itself, but check the tax treatment in each jurisdiction before you do — spend on a company card by a contractor can affect how the engagement is characterised, and that is a question for your advisers rather than for a spend tool.

### What happens to unreconciled card spend at year end?

It sits in a suspense account and an auditor will sample it. That is the strongest practical argument for collecting receipts and coding during the month rather than during the close.
:::
`,
};

const soc2: DocumentFixture = {
  type: "post",
  slug: "what-soc-2-type-ii-means-for-your-finance-stack",
  title: "What SOC 2 Type II means for your finance stack",
  description:
    "A SOC 2 Type II report says a vendor operated its stated controls over a period. Here is what that covers, what it does not, and how to read one properly.",
  author: "priya",
  category: "guides",
  tags: ["soc-2", "audit", "integrations"],
  entities: [
    { key: "soc-2-reports", salience: 0.9, primary: true },
    { key: "internal-control", salience: 0.6 },
  ],
  state: { kind: "published", publishedAt: "2026-02-03T09:15:00.000Z" },
  bodyMd: `:::tldr
A SOC 2 Type II report is an independent opinion that a vendor described its controls accurately and operated them over a stated period. It is not a security certification, it does not cover the controls the vendor chose to leave out of scope, and the exceptions section is the part worth reading first.
:::

## Type I and Type II are not the same claim

A Type I report says the controls were suitably designed on one particular date. A Type II says they operated effectively across a window — usually six or twelve months. The difference is between a photograph and a film, and it matters: a company can pass a Type I in a fortnight by writing policies it has never executed.

If a vendor sends you a Type I, the right follow-up question is when their first Type II window closes. If the answer is vague, treat the report as an intention rather than as evidence.

## Read the scope before the opinion

Every SOC 2 report names its Trust Services Criteria. Security is mandatory. Availability, processing integrity, confidentiality and privacy are optional, and a vendor is free to include only the first.

For a finance system, processing integrity is the criterion that actually maps to your risk. Security tells you an attacker probably cannot read your ledger. Processing integrity is the one that speaks to whether a posting is complete and accurate — which is what your own auditor will ask about when they sample your [month-end close](/blog/month-end-close-checklist).

## Go to the exceptions first

The opinion paragraph is boilerplate. The interesting section is the one describing tests performed and results, near the back, where deviations are listed. Almost every real report has some. What matters is their character.

An exception saying one access review ran eleven days late is a normal operating artefact. An exception saying terminated employees' access was not revoked within the stated period is a finding about a control that protects your data. Both are described in the same flat register, so the reading has to be yours.

## The complementary user entity controls

Near the end, every report lists complementary user entity controls: the things the report assumes *you* do. Enforcing single sign-on. Reviewing your own user list. Rotating API credentials. These are not suggestions — the vendor's opinion is conditional on them, and if you skip them the report does not cover the risk you thought it did.

This is the section most buyers never read, and it is the one that most often turns up in your own audit.

:::takeaways
- Type II proves operation over a period; Type I proves design on a single day.
- Check which Trust Services Criteria are in scope before reading anything else.
- Exceptions are normal — read what they are about, not how many there are.
- Complementary user entity controls are obligations on you, not on the vendor.
:::

:::faq
### Is SOC 2 a certification?

No. It is an attestation report produced by an independent auditor under AICPA standards. There is no certificate, no pass mark and no registry — which is why a vendor claiming to be "SOC 2 certified" is a small signal about how carefully they read their own report.

### How often should we re-request a vendor's report?

Once per audit period, and always before the period your own auditor will test. A report whose window closed fourteen months ago covers none of the time you are asking about.

### Does SOC 2 cover financial reporting controls?

Not directly. SOC 1 is the report family aimed at controls relevant to financial reporting; SOC 2 covers the Trust Services Criteria. If a vendor is part of your financial reporting process, ask which of the two they hold.
:::
`,
};

const approvalRules: DocumentFixture = {
  type: "post",
  slug: "approval-rules-that-dont-become-bottlenecks",
  title: "Approval rules that don't become bottlenecks",
  description:
    "Every approval step is a queue somebody has to drain. Two thresholds and one exception path will route most spend correctly without anyone babysitting a list.",
  author: "maya",
  category: "product",
  tags: ["approvals", "expense-policy"],
  entities: [
    { key: "expense-management", salience: 0.75, primary: true },
    { key: "internal-control", salience: 0.6 },
    { key: "acme", salience: 0.4 },
  ],
  cover: "flowApprovals",
  state: { kind: "published", publishedAt: "2026-03-10T11:00:00.000Z" },
  bodyMd: `:::tldr
Every approval step is a queue, and every queue has a person whose day it interrupts. Design the routing so the overwhelming majority of spend never reaches one: auto-approve below a threshold, route by budget ownership in the middle, and reserve human review for the genuinely large.
:::

## An approval is a queue

It is easy to add an approval step and hard to remove one, which is why approval chains only ever grow. Each one looks free at the moment it is added — it is one click for one person — and each one adds latency to every transaction that passes through it, forever.

The honest way to think about a step is as a queue with a service rate. If a director approves expenses twice a week, every claim routed to that director has an expected latency of two and a half days regardless of its size. Multiply by volume and the cost is visible.

![Diagram of an approval route with two thresholds and an exception path]({{media:flowApprovals}})

## Two thresholds cover most of it

Almost every routing table we have seen collapses cleanly into three bands.

Below the first threshold, approve automatically and sample afterwards. The spend is small, the review costs more than the exposure, and a random 5% sample catches patterns far more reliably than a rubber stamp on every line.

Between the thresholds, route to the person who owns the budget. Not to a manager, and not up a reporting line — to whoever is accountable for the number the spend lands against. They have the context, and they are the only person for whom the approval is genuinely informative rather than a formality.

Above the second threshold, route to finance, and expect it to be slow. It should be. Spend of that size deserves a conversation.

## Route by budget, not by hierarchy

Routing up the org chart is the default in most tools and it is almost always wrong. It sends a £900 conference ticket to a VP who has no idea what the marketing budget looks like this quarter, while the marketing lead who does know sees nothing.

Budget-based routing also fixes delegation. When the owner of a cost centre goes on leave, you reassign a budget rather than editing a rules table, and everything routes correctly the next morning. We wrote about the wider shift this enables in [budget owners, not budget police](/blog/budget-owners-not-budget-police).

## Time out, do not stall

An approval with no deadline is a request with no deadline. Give every step an expiry: if nobody acts within a stated window, the request either escalates or auto-approves, and everyone knows which in advance.

Auto-approval on timeout sounds reckless and is usually the right default below the second threshold. The alternative is not better control; it is an employee out of pocket for three weeks while a queue nobody owns quietly grows.

:::takeaways
- Treat every approval step as a queue with a real, measurable latency.
- Auto-approve small spend and sample it, rather than reviewing all of it badly.
- Route by budget ownership, never up the reporting line.
- Give every step a timeout, and decide in advance whether it escalates or clears.
:::

:::faq
### What should the auto-approval threshold be?

Start where your own review stops changing outcomes. For most teams that is between £50 and £100 — below it, approvals are almost never refused, which means the step is costing latency and buying nothing.

### Is auto-approval on timeout safe?

Below the second threshold, yes, provided you sample. The exposure is bounded by the threshold, and the alternative — an unbounded queue with no owner — creates a worse failure that is harder to see.
:::
`,
};

const receiptMatching: DocumentFixture = {
  type: "post",
  slug: "how-receipt-matching-works",
  title: "How receipt matching actually works at Acme",
  description:
    "Matching a receipt to a card authorisation is a scoring problem, not a lookup. The candidate window, the features we score and where we refuse to guess.",
  author: "daniel",
  category: "engineering",
  tags: ["reimbursements", "corporate-cards", "api"],
  entities: [
    { key: "acme", salience: 0.8, primary: true },
    { key: "expense-management", salience: 0.5 },
  ],
  state: { kind: "published", publishedAt: "2026-04-07T13:20:00.000Z" },
  bodyMd: `:::tldr
A receipt and a card authorisation almost never agree exactly: the amounts differ by a tip, the merchant name is a payment-processor descriptor, and the timestamps are in different time zones. Matching is a scoring problem over a bounded candidate set, and the important design decision is where the system refuses to guess.
:::

## Why exact matching does not work

The naive implementation joins on amount and date. It fails on the first restaurant receipt, because the authorisation was for the pre-tip amount and the settlement three days later was for the total. It fails again on the merchant string, because the card network shows \`SQ *BLUE BOTTLE 4417\` and the receipt says "Blue Bottle Coffee".

So the first thing the matcher does is stop trying to be exact.

## The candidate window

Every unmatched receipt is scored against authorisations from the same card within a bounded window. Bounded matters: an unbounded search over a year of transactions is both slow and much more likely to find a confident wrong answer.

\`\`\`sql
select t.id, t.amount_minor, t.merchant_descriptor, t.authorised_at
from card_transactions t
where t.card_id = $1
  and t.matched_receipt_id is null
  and t.authorised_at between $2::timestamptz - interval '4 days'
                          and $2::timestamptz + interval '2 days'
order by t.authorised_at desc
limit 50;
\`\`\`

The window is asymmetric on purpose. A receipt is almost always written at or after the authorisation, but time-zone skew and delayed settlement mean it can appear to precede it by a day or two. Four days back and two forward covers the overwhelming majority without opening the search up to a whole month.

## What gets scored

Four features, weighted, with an early exit.

\`\`\`ts
interface Candidate {
  amountMinor: number;
  merchantDescriptor: string;
  authorisedAt: Date;
  last4: string;
}

export function score(receipt: ParsedReceipt, candidate: Candidate): number {
  // An exact amount match on the same card is decisive on its own; nothing
  // else needs to agree, and insisting that it does costs us real matches.
  const amount = amountScore(receipt.totalMinor, candidate.amountMinor);
  if (amount === 1 && receipt.last4 === candidate.last4) return 1;

  return (
    amount * 0.5 +
    merchantScore(receipt.merchant, candidate.merchantDescriptor) * 0.3 +
    proximityScore(receipt.issuedAt, candidate.authorisedAt) * 0.15 +
    (receipt.last4 === candidate.last4 ? 0.05 : 0)
  );
}
\`\`\`

\`amountScore\` returns 1 on an exact match and decays over a tolerance band of 25%, which is wide enough to absorb a tip and narrow enough that two different lunches on the same day do not both look right. \`merchantScore\` normalises the descriptor — strips the processor prefix, the store number and the trailing digits — and then compares tokens rather than characters, because "BLUE BOTTLE" and "Blue Bottle Coffee" share a token and share almost no character bigrams.

## Where we refuse to guess

Above 0.90 the match is applied automatically. Between 0.65 and 0.90 it is suggested, with the runner-up shown alongside it. Below 0.65 nothing is proposed at all.

The band between "confident" and "silent" is the part that matters. A wrong automatic match is worse than no match: it attaches the wrong evidence to a transaction, and nobody looks at it again until an auditor pulls that line eleven months later. So the threshold is deliberately conservative, and the second-best candidate is always shown, because a person can distinguish two lunches in a second and the scorer cannot.

## What it costs

The whole pass runs in the card-notification path, so it has a budget of a few hundred milliseconds. Fifty candidates, four cheap features and no network calls keeps it comfortably inside that, which is the reason the collection happens at the till rather than at [month-end](/blog/month-end-close-checklist).

:::takeaways
- Exact matching fails on the first tipped restaurant bill; score instead.
- Bound the candidate window — an unbounded search finds confident wrong answers.
- Normalise merchant descriptors and compare tokens, not characters.
- Define a band where the system proposes nothing, and always show the runner-up.
:::
`,
};

const multiCurrency: DocumentFixture = {
  type: "post",
  slug: "modelling-multi-currency-spend",
  title: "How we model multi-currency spend in the ledger",
  description:
    "Storing one amount and a currency code is the bug. A card transaction has three amounts and two rates, and the ledger has to keep all of them separately.",
  author: "daniel",
  reviewer: "priya",
  category: "engineering",
  tags: ["api", "integrations", "month-end-close"],
  entities: [
    { key: "accounting", salience: 0.8, primary: true },
    { key: "gaap", salience: 0.6 },
    { key: "acme", salience: 0.4 },
  ],
  state: { kind: "published", publishedAt: "2026-05-06T10:45:00.000Z" },
  bodyMd: `:::tldr
A cross-border card transaction is not one amount. It is a merchant amount, a billing amount and a reporting amount, connected by two rates captured at two different moments. Storing a single number with a currency code loses information the close cannot reconstruct, and the fix is to keep all three.
:::

## Three amounts, not one

An employee in Berlin buys a €58 lunch on a card billed in pounds, and the accounts are reported in dollars. That single event carries:

- the **transaction amount**, €58.00, which is what the merchant charged and what the receipt shows;
- the **billing amount**, £49.71, which is what the card network settled and what appears on the statement;
- the **reporting amount**, $63.22, which is what the general ledger posts.

Each one is authoritative for a different question. The receipt reconciles to the first. The bank reconciles to the second. The trial balance reconciles to the third. A schema that keeps one of them and derives the rest will disagree with at least two of those three reconciliations, and it will disagree by small enough amounts that nobody notices until year end.

## The columns

\`\`\`sql
create table postings (
  id                bigserial primary key,
  entry_id          bigint      not null references entries(id),
  account_id        uuid        not null references accounts(id),

  -- What the merchant charged. Never recomputed.
  txn_amount_minor  bigint      not null,
  txn_currency      char(3)     not null,

  -- What the card network settled, at the network's own rate.
  bill_amount_minor bigint      not null,
  bill_currency     char(3)     not null,

  -- What the ledger posts, at the rate in force on the posting date.
  rpt_amount_minor  bigint      not null,
  rpt_currency      char(3)     not null,

  fx_rate_billing   numeric(20, 10) not null,
  fx_rate_reporting numeric(20, 10) not null,
  fx_rate_source    text        not null,
  fx_rate_as_of     date        not null
);
\`\`\`

Three things in that definition are load-bearing.

Amounts are integer minor units. Floating point is not a currency type, and the argument is not theoretical: a sum of ten thousand doubles will not tie to the same sum in a different order, and reconciliation is exactly a sum in a different order.

The rates are stored, not looked up. A rate is a fact about a moment, and the table you would look it up from is a table somebody backfills. If the posting does not carry the rate it was made at, the close cannot be reproduced next quarter.

And \`fx_rate_source\` is recorded, because "which rate did we use" is an audit question with a specific answer, and "the one in the rates table" is not it.

## Revaluation is a separate entry

The rate moves after posting. The correct treatment is not to update the row — it is to post an additional entry for the unrealised gain or loss, referencing the original.

| | Original posting | Revaluation |
| --- | --- | --- |
| Transaction amount | €58.00 | unchanged |
| Reporting amount | $63.22 | $64.05 |
| Entry type | Expense | FX gain/loss |
| Reversible | No | Yes, monthly |

Mutating the original would make the ledger unauditable: the posting would no longer equal the evidence attached to it, and every prior report built on it would silently change. Immutability here is not architectural purity, it is the property that lets somebody re-run last March.

## Rounding, once, at the boundary

Convert once and round once, at the point of posting, using banker's rounding, and store the result. Never convert a converted amount. The second conversion compounds the first one's rounding error, and on a few thousand transactions that is a real number sitting in a suspense account that nobody can explain.

:::takeaways
- Keep transaction, billing and reporting amounts separately; each reconciles to a different source.
- Store amounts as integer minor units, never as floats.
- Persist the rate and its source on the posting — a rate is a fact about a moment.
- Post revaluation as a new entry; never mutate the original.
:::
`,
};

const northwind: DocumentFixture = {
  type: "post",
  slug: "northwind-logistics-four-day-close",
  title: "Northwind Logistics cut its close to four days",
  description:
    "A 340-person logistics group moved receipt capture into the month and rebuilt its accruals from commitments. The close went from nine working days to four.",
  author: "tom",
  reviewer: "maya",
  category: "customer-stories",
  tags: ["month-end-close", "corporate-cards", "accounts-payable"],
  entities: [
    { key: "expense-management", salience: 0.7, primary: true },
    { key: "accounting", salience: 0.5 },
  ],
  cover: "quoteNorthwind",
  state: { kind: "published", publishedAt: "2026-06-02T08:00:00.000Z" },
  bodyMd: `:::tldr
Northwind Logistics closed its books in nine working days and wanted five. Moving receipt capture into the month, replacing a manual accrual spreadsheet with commitment data, and routing approvals by budget owner took them to four — without adding anyone to the finance team.
:::

## Where they started

Northwind runs 340 people across eleven depots, most of whom spend money: fuel, overnight accommodation, parts, and a long tail of small purchases that arrive as photographs of crumpled receipts. Finance is six people.

The close ran nine working days, and the controller, Elena Marsh, could account for almost all of it. "Two days were reconciliation and commentary — actual accounting. The other seven were waiting. Waiting for receipts, waiting for a depot manager to say what something was, waiting for one invoice from one supplier who posts everything on the 8th."

![Quote card: we stopped chasing receipts and started closing on the fourth working day]({{media:quoteNorthwind}})

## What changed

Three things, in this order.

**Receipt capture moved into the month.** Card holders now get a notification at the moment of authorisation and attach the receipt from the same screen. Capture inside 24 hours went from 31% to 88% in the first two months. The day-one chase list went from roughly 400 items to about 40.

**Accruals came off the spreadsheet.** The old process was a workbook maintained by one person, rebuilt each month from memory and email. It was replaced by a query over approved purchase orders and signed contracts, which is the same data the business had all along — it had simply never been in the same place as the ledger. We described the general shape of this in [accruals without the spreadsheet](/blog/accruals-without-the-spreadsheet).

**Approvals moved to budget owners.** Previously everything routed up the reporting line to two regional directors, both of whom were usually in a depot rather than at a desk. Routing to whoever owns the cost centre cut the median approval latency from 2.4 days to 4 hours.

## The numbers

| | Before | After |
| --- | --- | --- |
| Working days to close | 9 | 4 |
| Receipts captured within 24h | 31% | 88% |
| Median approval latency | 2.4 days | 4 hours |
| Unreconciled card spend at close | £61,000 | £4,300 |
| Finance headcount | 6 | 6 |

The last row is the one Elena points at. "Every proposal I had seen before this started with hiring. This did not."

## What did not change

Northwind kept its expense policy almost intact. The thresholds moved once — the receipt requirement went from £10 to £30 after a month of data showed the sub-£30 receipts were costing more to chase than they protected — but the categories, the travel rules and the entertainment limits stayed as they were.

That is worth saying plainly, because the usual pitch is that a new system requires a new policy. It mostly does not. The policy was fine. The gap was between the policy and the moment somebody spent money.

:::takeaways
- Seven of Northwind's nine close days were waiting, not accounting.
- Capture at the point of authorisation moved 24-hour receipt capture from 31% to 88%.
- Commitment-based accruals removed the single-person spreadsheet dependency.
- Budget-owner routing cut median approval latency from days to hours.
:::

:::faq
### How long did the rollout take?

Eleven weeks from first card issued to the first four-day close, with the card programme rolled out depot by depot rather than all at once.

### Did depot managers resist the change?

Less than finance expected. The notification-and-photo flow replaced a monthly claim form, so for most card holders the change removed work rather than adding it.
:::
`,
};

const accruals: DocumentFixture = {
  type: "post",
  slug: "accruals-without-the-spreadsheet",
  title: "Accruals without the spreadsheet",
  description:
    "The month-end accrual workbook is usually one person's memory in a grid. Building it from purchase orders and contracts makes it reproducible and auditable.",
  author: "priya",
  category: "guides",
  tags: ["month-end-close", "accounts-payable", "audit"],
  entities: [
    { key: "accounting", salience: 0.85, primary: true },
    { key: "gaap", salience: 0.7 },
  ],
  state: { kind: "published", publishedAt: "2026-06-24T09:30:00.000Z" },
  bodyMd: `:::tldr
Most accrual workbooks are one person's memory arranged in a grid. Rebuild them from data the company already holds — approved purchase orders, signed contracts, delivered-but-uninvoiced goods receipts — and the accrual becomes reproducible, reviewable and considerably faster.
:::

## The workbook problem

The accrual file is usually the least defensible artefact in the close. It is maintained by one person, rebuilt monthly from email and recollection, and it is almost always the first thing an auditor samples — precisely because it is the entry with the most judgement and the least evidence.

The problem is not the judgement. Accruals are supposed to involve judgement. The problem is that the inputs are not written down anywhere except in the workbook itself, so the judgement cannot be reviewed and the number cannot be reproduced.

## Start from commitments

The company already knows most of what it owes. An approved purchase order is a commitment. A signed contract with a monthly fee is a commitment. A goods receipt with no matching invoice is a commitment with a delivery date attached.

Pulling the accrual from those sources changes what the close is doing: instead of asking "what do we think we owe?", it asks "which of our known commitments have not yet been invoiced?" That is a query, and it produces a list with a reference against every line.

## The three buckets

**Received not invoiced.** Goods or services delivered, no invoice yet. The strongest bucket — there is a receipt document, a date and an amount. Accrue at PO value and let the invoice true it up.

**Contracted not delivered.** A recurring fee for a period that has elapsed. Straightforward for subscriptions, and the place to be careful about annual invoices billed in advance, which are a prepayment rather than an accrual.

**Estimated.** Everything genuinely uncertain: a legal bill that arrives quarterly, a utilities charge on a meter nobody has read. This bucket should be small. If it is large, the first two buckets are not being fed properly, and that is an operational problem rather than an accounting one.

## Keep the reversal automatic

Every accrual should carry its own reversal in the following period, posted at the same time it is created. Manual reversals are how a duplicate expense reaches the P&L: the accrual is posted in March, the invoice arrives in April, and the reversal was on somebody's list.

Automatic reversal also makes the accuracy visible. If March's accrual reverses and April's invoice lands within a few percent, the estimate was good. If it lands 40% out every month, the estimating method needs work, and now there is a number that says so.

## What the auditor will ask

Three questions, and all of them are easier when the accrual has a source.

How was the population identified? — "Approved POs with no matched invoice at period end" is an answer. "Judgement" is not.

How was completeness tested? — Compare the accrual against invoices received in the subsequent period, and show the tie-out. This is the [search for unrecorded liabilities](/blog/month-end-close-checklist), and it is far quicker when the accrual is already a query.

Who reviewed it? — Somebody other than the preparer, with a date. A two-line control, and the one most often missing.

:::takeaways
- Rebuild accruals from commitments the business already records, not from memory.
- Split into received-not-invoiced, contracted-not-delivered and estimated — and keep the third bucket small.
- Post the reversal at the same time as the accrual, never as a follow-up task.
- Track reversal accuracy; it is free evidence that the estimates are sound.
:::

:::faq
### Should we accrue for purchase orders that have not been delivered?

No. An unfulfilled purchase order is a commitment, not a liability — nothing has been received. It belongs in the commitments note and in the [forecast](/blog/forecasting-spend-from-commitments), not in the accrual.

### How small is too small to accrue?

Set a threshold and apply it consistently. Most mid-sized teams land somewhere between £500 and £2,000 per line. What matters to an auditor is that the threshold is stated and applied, not where exactly it sits.

### Do accruals need to reverse in the very next period?

Yes, unless you are using a rolling accrual for a genuinely continuous obligation. The reversal is what stops the same cost being recognised twice when the invoice finally arrives.
:::
`,
};

const budgetOwners: DocumentFixture = {
  type: "post",
  slug: "budget-owners-not-budget-police",
  title: "Budget owners, not budget police",
  description:
    "Finance teams spend their week approving spend they cannot evaluate. Giving budget owners a live number and a limit turns policing back into real ownership.",
  author: "maya",
  category: "product",
  tags: ["approvals", "forecasting", "expense-policy"],
  entities: [
    { key: "expense-management", salience: 0.8, primary: true },
    { key: "acme", salience: 0.45 },
  ],
  state: { kind: "published", publishedAt: "2026-07-21T09:00:00.000Z" },
  bodyMd: `:::tldr
Finance ends up approving spend it has no way to evaluate, which is not control — it is a queue with a person in it. Give the budget owner a live number, a limit and the decision, and finance gets to do the work only finance can do.
:::

## Why finance ends up in the middle

Nobody designs this. It accumulates. An early-stage company has one person who knows what everything costs, so everything goes to them. The company grows, the routing stays, and eventually a finance manager is approving a £400 software renewal for a team whose roadmap they have never seen.

They approve it, of course. They have no basis to refuse. And that is the tell: an approval step where the answer is always yes is not a control, it is latency wearing a control's clothes.

## What a budget owner needs

Three things, and most companies provide none of them.

**A live number.** Not last month's actuals in a report emailed on the 12th. The current committed position, including approved-but-uninvoiced spend, visible on the day the decision is made.

**A limit that means something.** An owner who cannot say no has not been given ownership. If every decision above £500 escalates, the ownership is nominal.

**Consequences that are theirs.** A variance that lands on the owner's line, discussed with the owner, not absorbed silently into a finance-owned contingency.

## Committed, not invoiced

The number most companies show budget owners is invoiced spend, which is the least useful of the available numbers. By the time an invoice is booked, the decision was made weeks ago and the money is gone.

The number that supports a decision is committed spend: approved purchase orders, signed contracts, card authorisations that have not yet settled. It is available earlier, it is what remains actionable, and it is the only version of the number where an owner can still change the answer. We wrote up the mechanics in [forecasting spend from commitments](/blog/forecasting-spend-from-commitments).

## What finance does instead

This is not an argument for finance to step back from spend. It is an argument about which questions are worth a finance person's day.

Whether a £400 renewal is worthwhile is a question the team using the software can answer better. Whether the company is carrying four overlapping tools at £40,000 a year is a question only finance will ever ask. Routing every small decision through finance guarantees the first question gets a low-quality answer and the second never gets asked at all.

:::takeaways
- An approval step that is always approved is latency, not control.
- Budget owners need a live committed number, a real limit and the variance on their own line.
- Committed spend supports decisions; invoiced spend only reports them.
- Finance's time is better spent on the questions nobody else is positioned to ask.
:::
`,
};

const forecasting: DocumentFixture = {
  type: "post",
  slug: "forecasting-spend-from-commitments",
  title: "Forecast spend from commitments, not invoices",
  description:
    "An invoice-based forecast tells you what already happened. Building from purchase orders, contracts and card authorisations moves the picture weeks earlier.",
  author: "maya",
  reviewer: "daniel",
  category: "product",
  tags: ["forecasting", "accounts-payable", "integrations"],
  entities: [
    { key: "expense-management", salience: 0.8, primary: true },
    { key: "accounting", salience: 0.5 },
    { key: "acme", salience: 0.4 },
  ],
  cover: "dashboardSpend",
  state: { kind: "published", publishedAt: "2026-08-18T10:15:00.000Z" },
  bodyMd: `:::tldr
A forecast built from invoices is a description of the past with a trend line attached. Building it from commitments — approved purchase orders, signed contracts and unsettled card authorisations — moves the picture three to six weeks earlier, which is the difference between reporting a variance and preventing one.
:::

## The lag nobody prices

Between the moment a company commits to spending money and the moment that spend appears in a report, there are typically four steps: someone approves it, the vendor delivers, the vendor invoices, and accounts payable books it. Each has its own latency, and they compound.

For subscription software the gap is usually two to four weeks. For anything involving a purchase order and a delivery it is six to ten. A forecast that begins at the fourth step is describing decisions made in the previous quarter.

![Acme spend dashboard showing committed spend and budget variance]({{media:dashboardSpend}})

## What counts as a commitment

Four sources, in descending order of certainty.

**Signed contracts with a schedule.** The most certain input available. A twelve-month contract at £4,000 a month is £48,000 of known spend, and it should be in the forecast from the day of signature rather than appearing one twelfth at a time.

**Approved purchase orders.** A commitment with an amount and an intended date. Some will change and a few will be cancelled; both are cheaper to model than the alternative of ignoring them.

**Card authorisations not yet settled.** Small individually, and reliably the fastest-moving part of a company's spend. In aggregate they are the earliest available signal that a team's run rate has changed.

**Approved requisitions with no purchase order yet.** Weakest of the four, and worth including with a haircut rather than excluding — an approved requisition is a decision that has already been made.

## Where the estimate goes wrong

Two failure modes, and they pull in opposite directions.

Double counting is the common one. A purchase order becomes an invoice, and if the forecast adds both, spend is overstated for exactly as long as nobody investigates. The fix is a lifecycle on every commitment, with the invoice retiring the purchase order rather than joining it.

Under-counting is subtler. Commitments cancel, and if the model never retires them the forecast slowly fills with obligations that no longer exist. Both fixes are the same discipline: a commitment has states, and something has to move it through them.

## Show the composition

The forecast number is much more useful when the interface says what it is made of. "£1.94M committed this quarter" is a figure to argue with. "£1.94M: £1.2M contracted, £510K on open POs, £180K in unsettled card spend, £50K approved-not-ordered" is a figure to act on, because it says which lever is available.

That is also the honest presentation. The four sources have genuinely different certainties, and collapsing them into one number quietly asserts that they do not.

:::takeaways
- Invoice-based forecasts describe decisions made six or more weeks ago.
- Rank commitment sources by certainty and keep them visible separately.
- Give every commitment a lifecycle so invoices retire it rather than adding to it.
- Show the composition of the number, not just the number.
:::

:::faq
### How far ahead can a commitment-based forecast see?

Typically three to six weeks further than an invoice-based one, and considerably more where long contracts dominate the spend. The gain is largest for teams with purchase orders and physical delivery.

### What about spend nobody has committed to yet?

That is a plan, not a forecast, and it belongs in a separate line. Mixing modelled headcount growth into a commitment view destroys the property that makes the view useful — that every number in it traces to a document.
:::
`,
};

/* ------------------------------------------------------------------ */
/* Drafts, scheduled, in review, archived                              */
/* ------------------------------------------------------------------ */

const travelDraft: DocumentFixture = {
  type: "post",
  slug: "travel-policy-for-distributed-teams",
  title: "A travel policy for distributed teams",
  description:
    "Travel policy written for a single-office company falls apart when everyone lives somewhere else. Per diems, home-city rules and what to do about time zones.",
  author: "maya",
  category: "guides",
  tags: ["travel", "expense-policy", "reimbursements"],
  entities: [
    { key: "corporate-travel-management", salience: 0.9, primary: true },
    { key: "expense-management", salience: 0.5 },
  ],
  state: { kind: "draft", createdAt: "2026-08-26T14:20:00.000Z" },
  /**
   * The image below is the asset with no alt text, and the markdown does not
   * supply one either. That combination is a blocking finding, so this draft
   * cannot be published — which is the point. It is the only way to see the
   * refusal state and the findings panel on a real document.
   */
  expectBlocked: true,
  bodyMd: `:::tldr
A travel policy written for a company with one office assumes a home city, a commute and a shared time zone. Take those away and most of the rules stop parsing. This is a rewrite from the distributed case outwards.
:::

## What breaks first

The phrase "travel to the office" does most of the work in a conventional policy, and in a distributed company it means nothing. Is a Lisbon-based engineer flying to a London offsite travelling for work? Obviously. Is the same engineer taking a train to a coworking space forty minutes away? Much less obviously, and the policy has to say.

## Per diems earn their keep here

Per diems are unfashionable and they are the right answer for distributed teams. Receipt-based meal reimbursement assumes a comparable cost of living, and £30 a day is generous in Porto and insulting in Zurich.

A per diem table indexed to city solves the fairness problem and removes an entire category of receipts from the [close](/blog/month-end-close-checklist).

![]({{media:receiptCapture}})

## Home city, and what counts as leaving it

Define a home city per person, recorded in the HR system rather than inferred from an address. Travel beyond it is travel. Travel within it is not, with one carve-out for the person whose home city is genuinely enormous.

## Open questions

- Do we cover the cost of a coworking desk, and if so, monthly or per day?
- What is the rule for a partner joining a work trip at their own expense?
- Do we reimburse seat selection? (Elena thinks yes for anything over four hours.)
- Time-zone recovery: is a day either side of a long-haul flight a working day?

## Booking

Still to write. The current draft says "book through the tool" and does not say what happens when the tool has no inventory on the route, which is roughly a third of the time for the Lisbon and Kraków teams.
`,
};

const vendorStub: DocumentFixture = {
  type: "post",
  slug: "vendor-consolidation-notes",
  title: "Notes: vendor consolidation",
  description:
    "Early notes toward a piece on consolidating overlapping vendors: how to find the overlap, what it actually saves, and when it costs more than it saves.",
  author: "tom",
  category: "product",
  tags: ["accounts-payable", "forecasting"],
  entities: [{ key: "expense-management", salience: 0.3 }],
  state: { kind: "draft", createdAt: "2026-09-01T16:40:00.000Z" },
  bodyMd: `## Rough shape

Three overlapping tools at £40k a year is the example everyone recognises. Start there.

Need to ask Elena for the Northwind numbers before this goes anywhere.
`,
};

const fourDayWeek: DocumentFixture = {
  type: "post",
  slug: "closing-the-books-in-a-four-day-week",
  title: "Closing the books in a four-day week",
  description:
    "A four-day week removes twenty per cent of the close window and none of the work. What has to change, and which of the usual shortcuts do not survive.",
  author: "priya",
  category: "guides",
  tags: ["month-end-close", "audit"],
  entities: [
    { key: "accounting", salience: 0.8, primary: true },
    { key: "internal-control", salience: 0.4 },
  ],
  state: { kind: "scheduled", publishAt: "2026-09-16T08:00:00.000Z" },
  bodyMd: `:::tldr
A four-day week takes twenty per cent out of the close window and none of the work out of the close. The teams that manage it do so by moving work into the month rather than by compressing the days that remain, and by giving up on two habits that do not survive the shorter week.
:::

## The arithmetic is unforgiving

A five-working-day close in a five-day week ends on the same calendar day it always did. The same close in a four-day week ends a day and a half later, because the weekend is longer and the days do not stretch.

Teams that try to absorb this by working harder inside the window last about two quarters. The ones that succeed do something structural first.

## Move the work, do not compress it

Every hour of close work that depends only on data available before period end can be done before period end. Receipt collection, coding, vendor statement reconciliation, intercompany confirmations, fixed asset additions — none of these need the period to be over.

What genuinely cannot move is the part that depends on the final population: the last few days of card spend, the cut-off testing, the flux commentary. That is two days of work for most mid-sized teams, which is a four-day close with a day of slack — but only if everything else has already happened.

## Two habits that do not survive

**The sequential review.** Preparer finishes everything, then the reviewer starts. In a compressed window that serialises two people who could work in parallel. Review by area as each area completes.

**The single close-day meeting.** A ninety-minute meeting on day three where everything is discussed at once is a meeting that blocks eight people for a problem affecting two of them. Replace it with a short standing checkpoint and written status.

## What the auditor thinks

Nothing, provided the controls still operate and are still evidenced. A shorter close is not a control weakness. A shorter close achieved by skipping the second review is, and it is visible immediately in the sign-off trail — which is a good reason to keep the trail rather than to shorten it too.

:::takeaways
- The window shrinks by a fifth; the work does not shrink at all.
- Move everything that does not depend on the final population into the month.
- Review by area in parallel rather than end to end.
- Compressing the review, rather than the schedule, is the one change an auditor will notice.
:::
`,
};

const purchaseOrders: DocumentFixture = {
  type: "post",
  slug: "what-teams-get-wrong-about-purchase-orders",
  title: "What teams get wrong about purchase orders",
  description:
    "Purchase orders are treated as paperwork and used as approvals. Understanding what a PO commits you to fixes both the accrual and the vendor argument.",
  author: "priya",
  reviewer: "maya",
  category: "guides",
  tags: ["accounts-payable", "approvals"],
  entities: [
    { key: "accounting", salience: 0.7, primary: true },
    { key: "internal-control", salience: 0.5 },
  ],
  state: { kind: "in_review", createdAt: "2026-08-28T11:05:00.000Z" },
  bodyMd: `:::tldr
A purchase order is an offer to buy on stated terms, not an internal approval form. Teams that treat it as paperwork end up with POs that do not match what was ordered, accruals that cannot be tied out, and no written position when a vendor invoices for something else.
:::

## A PO is a contract term, not a form

When a vendor accepts a purchase order, the terms on it are the terms of the purchase — quantity, price, delivery date and whatever is printed on the back. That is the point of the document, and it is the part most internal processes ignore in favour of using it as a routing mechanism for approvals.

The consequence shows up in a dispute. If the PO says 200 units at £14 and the invoice says 240 at £16, the PO is the written position. If nobody has ever looked at the terms on it, there is no written position and the argument is conducted by recollection.

## Three-way matching, and why the third way matters

The purchase order says what was ordered. The goods receipt says what arrived. The invoice says what is being charged. Matching all three is the control, and it is the only one of the standard AP controls that catches quantity fraud rather than merely price fraud.

Two-way matching — invoice against PO — is common because goods receipting is tedious. It also means the company pays for anything that was ordered, whether or not it turned up.

## Where the accrual comes in

A received-but-uninvoiced goods receipt is the strongest accrual line there is: a document, a date, a quantity and a price. Teams that skip receipting lose that, and rebuild the same number from memory a fortnight later. This is the connection between a process people find tedious and a close people find painful, and it is worth stating explicitly to whoever is deciding whether receipting is worth the effort.

## Blanket orders

For recurring spend against a single vendor, a blanket PO with a value ceiling and a period is far more useful than a monthly stream of individual ones. It gives the vendor certainty, it gives the budget owner a single number to watch, and it gives the accrual a clean denominator.

The failure mode is the blanket PO nobody closes, which sits open at £0 remaining for two years. Give them expiry dates.

:::faq
### Do small companies need purchase orders at all?

Below roughly fifty people, generally not for everything — but they are worth introducing for any vendor relationship above a threshold you set, because that is where a dispute becomes expensive and where the accrual becomes material.

### Is a PO legally binding?

It is an offer, and it generally becomes binding on acceptance by the vendor. Exactly how that works depends on the jurisdiction and on the terms attached, which is a question for your legal advisers rather than for a spend tool.
:::
`,
};

const benchmarks: DocumentFixture = {
  type: "post",
  slug: "2025-spend-benchmarks",
  title: "2025 spend benchmarks for finance teams",
  description:
    "Our 2025 benchmark data on close times, card adoption and approval latency across 180 finance teams. Superseded by the 2026 edition, kept here for reference.",
  author: "tom",
  category: "guides",
  tags: ["forecasting", "expense-policy"],
  entities: [{ key: "expense-management", salience: 0.6, primary: true }],
  state: { kind: "archived", publishedAt: "2025-10-08T09:00:00.000Z" },
  bodyMd: `:::tldr
Benchmark data gathered from 180 finance teams during 2025: median days to close, corporate card adoption by headcount band, and median approval latency. Superseded by the 2026 edition; retained because several posts still cite these figures.
:::

## Days to close

The median close across the sample ran seven working days, with a long tail. Teams under fifty people closed faster than teams between fifty and two hundred, which surprised us until we looked at the entity count — a second legal entity added roughly two days on its own, regardless of headcount.

The fastest decile closed in three days. Without exception they captured card receipts during the month rather than after it.

## Card adoption

Adoption rose sharply with headcount and then flattened. Under twenty-five people, 34% of teams issued corporate cards. Between twenty-five and one hundred, 71%. Above one hundred, 89%, and the remaining 11% were concentrated in regulated industries with specific procurement constraints.

## Approval latency

Median time from submission to decision was 1.9 days across the sample. Teams routing to a budget owner rather than up a reporting line reported a median of 6 hours, which is the single largest difference in the dataset and the reason we wrote about it separately in [approval rules that don't become bottlenecks](/blog/approval-rules-that-dont-become-bottlenecks).

## Method

Responses were self-reported through a survey run between March and September 2025, with 180 usable responses from a sample of 412. Self-reporting means the close-time figures are probably optimistic by a day or so; the relative comparisons are more reliable than the absolute numbers.

Figures in this edition have been superseded. The current data is in the 2026 benchmark report.
`,
};

/* ------------------------------------------------------------------ */
/* Pages and blocks                                                    */
/* ------------------------------------------------------------------ */

const aboutPage: DocumentFixture = {
  type: "page",
  slug: "about",
  title: "About Acme: spend management for finance teams",
  description:
    "Acme builds spend management software for finance teams: corporate cards, expenses, approvals and payables in one ledger. Who we are and what we believe.",
  author: "maya",
  tags: ["expense-policy"],
  entities: [
    { key: "acme", salience: 0.95, primary: true },
    { key: "software-as-a-service", salience: 0.5 },
  ],
  state: { kind: "published", publishedAt: "2025-10-02T09:00:00.000Z" },
  bodyMd: `## What we build

Acme is spend management software for finance teams. Corporate cards, expense claims, approval routing and accounts payable sit on one ledger, which means the reconciliation that usually happens at [month-end](/blog/month-end-close-checklist) mostly happens as the money moves.

We started in 2021 because two of us had spent years closing books for companies where the card statement, the expense tool and the general ledger were three separate systems that disagreed with each other every month.

## What we believe

**Controls belong before the spend.** A limit applied at authorisation is a control. A conversation after the fact is an escalation.

**The person who owns the budget should make the decision.** Finance is not better placed to judge whether a team needs a piece of software; it is uniquely placed to notice that four teams are paying for the same one.

**Close faster by collecting earlier.** Almost every slow close is a waiting problem, and almost all of the waiting can be moved into the month.

## Who we are

Around ninety people, distributed across the UK, Portugal and Poland, with a registered office in London. Roughly a third of the company has worked in an accounting or finance operations role, which shows up in the product more than in the marketing.

## Getting in touch

Sales and demos: [hello@acme.com](mailto:hello@acme.com). Support for existing customers is in the product, and answered by people who can read the ledger. Security questions, including our current SOC 2 report, go to the [security page](/security).
`,
};

const pricingPage: DocumentFixture = {
  type: "page",
  slug: "pricing",
  title: "Acme pricing: plans, limits and what counts",
  description:
    "Three plans, priced per active spender per month, with no charge for approvers or viewers. What each tier includes and what counts as an active spender.",
  author: "tom",
  reviewer: "maya",
  tags: ["expense-policy"],
  entities: [
    { key: "acme", salience: 0.9, primary: true },
    { key: "software-as-a-service", salience: 0.6 },
  ],
  state: { kind: "published", publishedAt: "2025-10-02T09:05:00.000Z" },
  bodyMd: `## Three plans

| | Starter | Growth | Scale |
| --- | --- | --- | --- |
| Per active spender / month | £6 | £11 | Custom |
| Corporate cards | Unlimited | Unlimited | Unlimited |
| Approval routing | Single threshold | Budget-owner routing | Custom rules |
| Accounts payable | — | Included | Included |
| Multi-entity | — | 2 entities | Unlimited |
| GL integrations | Xero, QuickBooks | + NetSuite, Sage | + custom |
| SSO and SCIM | — | SSO | SSO and SCIM |
| Support | Email | Email and chat | Named contact |

## What counts as an active spender

Someone who submitted a claim or made a card transaction in the billing month. Approvers, budget owners, auditors and read-only finance staff are free, and always will be — charging for the reviewer is how approval chains end up shortened for the wrong reason.

A person who spends nothing in a month is not billed for that month, and there is nothing to configure to make that happen.

## What is not metered

Cards issued, transactions processed, receipts stored, API calls, webhook deliveries and users in a viewer role. We would rather you issue a card to everyone who needs one than ration them against a seat count.

## Card programme costs

Card issuance and processing are included. Foreign exchange on cross-border transactions is charged at the network rate plus 0.5%, shown on every transaction at the time it is authorised rather than aggregated into a monthly line — the mechanics are described in [how we model multi-currency spend](/blog/modelling-multi-currency-spend).

## Getting a quote

Scale pricing depends on entity count, spend volume and the integrations involved. Email [hello@acme.com](mailto:hello@acme.com) with a rough headcount and we will send a number rather than a discovery call.
`,
};

const securityPage: DocumentFixture = {
  type: "page",
  slug: "security",
  title: "Security and compliance at Acme",
  description:
    "How Acme protects customer data: SOC 2 Type II, encryption, access control, our card data scope and how to reach the team about a vulnerability or a report.",
  author: "daniel",
  reviewer: "priya",
  tags: ["soc-2", "audit"],
  entities: [
    { key: "soc-2-reports", salience: 0.85, primary: true },
    { key: "internal-control", salience: 0.6 },
    { key: "acme", salience: 0.5 },
  ],
  state: { kind: "published", publishedAt: "2025-10-02T09:10:00.000Z" },
  bodyMd: `## Attestations

Acme holds a SOC 2 Type II report covering Security, Availability and Processing Integrity, with a twelve-month observation window. The current report and our most recent penetration test summary are available under NDA — email [security@acme.com](mailto:security@acme.com).

If you have not read one before, we wrote a plain guide to [what a SOC 2 Type II report actually says](/blog/what-soc-2-type-ii-means-for-your-finance-stack), including the sections most buyers skip.

## Data protection

All customer data is encrypted in transit with TLS 1.3 and at rest with AES-256. Database backups are encrypted with separately managed keys and are restored into an isolated environment on a quarterly schedule, because an untested backup is a hypothesis.

Production data is not copied into development or staging environments. Engineers debugging a customer issue work against a redacted extract with a time-boxed, logged grant.

## Card data

Acme does not store full primary account numbers. Card issuance and processing run through a PCI DSS Level 1 certified issuer processor, and our systems hold only the last four digits and a network token. This keeps card data out of our scope by design rather than by policy.

## Access control

Single sign-on is available on Growth and Scale, and SCIM provisioning on Scale. Internally, production access is role-based, granted just in time, expires automatically, and is reviewed quarterly against the HR system rather than against a spreadsheet.

## Reporting a vulnerability

Email [security@acme.com](mailto:security@acme.com). We acknowledge within one business day, and we do not pursue legal action against researchers acting in good faith under our disclosure policy. There is no bug bounty programme at present; we say so rather than leaving it ambiguous.

## Subprocessors

A current list of subprocessors, with the data each one handles and its location, is maintained at acme.com/subprocessors and notified thirty days before any addition.
`,
};

const ctaBlock: DocumentFixture = {
  type: "block",
  slug: "cta-demo",
  title: "Call to action: book a product walkthrough",
  description:
    "The reusable end-of-post call to action inviting readers to book a walkthrough of Acme. Embedded at the foot of guides and customer stories across the blog.",
  author: "tom",
  tags: ["expense-policy"],
  entities: [{ key: "acme", salience: 0.8, primary: true }],
  state: { kind: "published", publishedAt: "2025-10-02T09:15:00.000Z" },
  bodyMd: `## See a four-day close

Acme puts cards, expenses, approvals and payables on one ledger, so most of the reconciliation happens as the money moves rather than in the week after period end.

A walkthrough takes about thirty minutes and is run by someone who has closed a set of books. Bring your current close calendar and we will tell you honestly which parts we would not change.

[Book a walkthrough](https://acme.com/demo) or email [hello@acme.com](mailto:hello@acme.com).
`,
};

const disclaimerBlock: DocumentFixture = {
  type: "block",
  slug: "footer-disclaimer",
  title: "Editorial and accounting disclaimer",
  description:
    "The standing footer notice clarifying that Acme's editorial content is general guidance and not accounting, tax or legal advice for any particular business.",
  author: "priya",
  tags: ["audit"],
  entities: [{ key: "accounting", salience: 0.6, primary: true }],
  state: { kind: "published", publishedAt: "2025-10-02T09:20:00.000Z" },
  bodyMd: `## About this content

Articles on the Acme blog are written by our finance and engineering teams and reviewed by a qualified accountant before publication. They describe general practice and are not accounting, tax or legal advice for any particular business.

Thresholds, treatments and reporting requirements vary by jurisdiction and by entity, and change over time. Before acting on anything here, check the position with your own advisers.

Where a figure comes from our own benchmark data, the sample and method are stated in the article. Where an article describes a customer's results, those results are theirs and are not a projection of yours.
`,
};

/**
 * Publication order matters to the seeder in one respect only: documents are
 * created in this order, so a `previousSlug` rename and the links pointing at
 * it resolve against a corpus that already exists.
 */
export const documents: DocumentFixture[] = [
  // Published, oldest first, so the archive and the dashboard both look lived-in.
  benchmarks,
  aboutPage,
  pricingPage,
  securityPage,
  ctaBlock,
  disclaimerBlock,
  expensePolicy,
  closeChecklist,
  cardsVsReimbursements,
  soc2,
  approvalRules,
  receiptMatching,
  multiCurrency,
  northwind,
  accruals,
  budgetOwners,
  forecasting,
  // Everything that is not live.
  travelDraft,
  vendorStub,
  fourDayWeek,
  purchaseOrders,
];
