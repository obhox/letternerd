import type {
  AuthorFixture,
  CategoryFixture,
  EntityFixture,
  ImageFixture,
  TagFixture,
} from "./types";

/**
 * Acme: the site, the people and the taxonomy.
 *
 * Everything here is filled in, including the fields a real team leaves empty
 * for a year. That is not padding — an empty `feedDescription` or a blank
 * `llmsIntro` reads on a screenshot as a product that does not do very much,
 * and the settings screen is one of the first things anyone looks at.
 *
 * The single exception is the fourth author, who is sparse on purpose. See the
 * comment on `tom`.
 */

export const SITE_SLUG = "acme";

export const site = {
  slug: SITE_SLUG,
  name: "Acme",
  baseUrl: "https://acme.com",
  blogBasePath: "/blog",
  additionalDomains: ["https://staging.acme.com"],
  locale: "en",
  timeZone: "America/New_York",
  orgName: "Acme, Inc.",
  orgLogoUrl: "https://acme.com/brand/acme-mark.png",
  orgSameAs: [
    "https://www.linkedin.com/company/acme",
    "https://x.com/acme",
    "https://github.com/acme",
  ],
  twitterHandle: "@acme",
  feedTitle: "The Acme Blog",
  feedDescription:
    "Practical writing on expense policy, corporate cards and the month-end close, from the team building Acme.",
  llmsIntro:
    "Acme is spend management software for finance teams: corporate cards, expense reports, " +
    "approvals and accounts payable in one ledger that reconciles itself. This blog is written " +
    "by Acme's finance and engineering teams for controllers, accounting managers and the " +
    "people who own a budget line.",
  /**
   * Written out rather than left null because robots.txt is generated, and a
   * generated file with nothing site-specific in it looks like a placeholder.
   * The staging disallow is the rule an actual team would have added first.
   */
  robotsExtra: [
    "# Staging mirrors production content; keep it out of the index.",
    "User-agent: *",
    "Disallow: /preview/",
    "Disallow: /app/",
    "",
    "Sitemap: https://acme.com/sitemap.xml",
  ].join("\n"),
  /** Background, accent and wordmark for generated OG cards. */
  ogTemplate: {
    background: "#0B1220",
    accent: "#2B59FF",
    textColor: "#F7F8FA",
    wordmark: "Acme",
    font: "Inter",
  },
} as const;

/**
 * The two studio logins.
 *
 * Two, because a Members screen listing one person says nothing about roles,
 * and the difference between owner and editor is one of the things worth
 * seeing. Both are real better-auth accounts — see the note in `seed-demo.ts`
 * about why the password is not written directly into the user row.
 */
export const OWNER_EMAIL = "maya.oduya@acme.com";
export const EDITOR_EMAIL = "daniel.reyes@acme.com";
export const DEFAULT_PASSWORD = "acme-demo-2026";
/** A seat that has been offered and not yet taken, so the screen shows both states. */
export const PENDING_INVITE_EMAIL = "priya.raghavan@acme.com";

export const images: ImageFixture[] = [
  {
    slot: "coverExpensePolicy",
    filename: "acme-expense-policy-cover.png",
    width: 1600,
    height: 900,
    alt: "Abstract cover graphic for Acme's expense policy guide, in navy and indigo.",
    caption: "The policy guide, in one page.",
    credit: "Acme design team",
  },
  {
    slot: "chartCloseCycle",
    filename: "acme-close-cycle-days.png",
    width: 1600,
    height: 900,
    alt: "Bar chart showing days to close falling from nine days in January to four days in August.",
    caption: "Days from period end to signed-off close, across one finance team's year.",
    credit: "Acme benchmark data",
  },
  {
    slot: "dashboardSpend",
    filename: "acme-spend-dashboard.png",
    width: 1600,
    height: 900,
    alt: "Acme spend dashboard showing committed spend, budget variance and the ten largest vendors.",
    caption: "Committed spend, not invoiced spend — the number a budget owner can still act on.",
  },
  {
    slot: "quoteNorthwind",
    filename: "northwind-logistics-quote.png",
    width: 1600,
    height: 900,
    alt: "Quote card reading: we stopped chasing receipts and started closing on the fourth working day.",
    credit: "Northwind Logistics",
  },
  {
    slot: "flowApprovals",
    filename: "acme-approval-routing.png",
    width: 1600,
    height: 900,
    alt: "Diagram of an approval route: submitted, then auto-approved under the threshold, or sent to a budget owner and then to finance.",
    caption: "Two thresholds and one exception path. Everything else routes itself.",
  },
  {
    slot: "receiptCapture",
    filename: "acme-receipt-capture.png",
    width: 1400,
    height: 788,
    /**
     * The one asset with no alt text.
     *
     * It backs both empty states that are otherwise impossible to photograph:
     * the media library's missing-alt queue, and the draft that the publish
     * gate refuses. Do not "fix" this by writing alt text here — fix it in the
     * studio, which is the point of the affordance.
     */
    alt: null,
  },
  {
    slot: "avatarMaya",
    filename: "maya-oduya.png",
    width: 512,
    height: 512,
    alt: "Portrait placeholder for Maya Oduya.",
  },
  {
    slot: "avatarDaniel",
    filename: "daniel-reyes.png",
    width: 512,
    height: 512,
    alt: "Portrait placeholder for Daniel Reyes.",
  },
  {
    slot: "avatarPriya",
    filename: "priya-raghavan.png",
    width: 512,
    height: 512,
    alt: "Portrait placeholder for Priya Raghavan.",
  },
];

export const authors: AuthorFixture[] = [
  {
    key: "maya",
    slug: "maya-oduya",
    name: "Maya Oduya",
    jobTitle: "Head of Finance Operations",
    bioMd:
      "Maya runs finance operations at Acme, where she owns the expense policy, the card " +
      "programme and the close calendar. Before Acme she spent six years in accounting " +
      "operations at a logistics group, closing the books across four entities and three " +
      "currencies.\n\nShe writes here about the parts of spend management that are policy " +
      "problems wearing a software costume.",
    email: "maya.oduya@acme.com",
    url: "https://mayaoduya.com",
    sameAs: [
      "https://www.linkedin.com/in/mayaoduya",
      "https://x.com/mayaoduya",
      "https://mayaoduya.com/about",
    ],
    knowsAbout: [
      "expense policy",
      "month-end close",
      "corporate card programmes",
      "accounts payable",
      "internal controls",
    ],
    credentials: {
      alumniOf: "University of Manchester",
      affiliation: "Acme, Inc.",
      award: "IMA Financial Operations Award, 2023",
    },
    avatar: "avatarMaya",
    account: "owner",
  },
  {
    key: "daniel",
    slug: "daniel-reyes",
    name: "Daniel Reyes",
    jobTitle: "Staff Engineer, Payments",
    bioMd:
      "Daniel works on the ledger and the card authorisation path at Acme. He is responsible " +
      "for the parts of the product that must be right the first time: multi-currency " +
      "postings, receipt matching and the reconciliation job that runs every night.\n\nHe has " +
      "been building payments systems since 2014, most of that time on the boring end of it.",
    email: "daniel.reyes@acme.com",
    url: "https://danielreyes.dev",
    sameAs: ["https://www.linkedin.com/in/danielreyesdev", "https://github.com/danielreyes"],
    knowsAbout: [
      "double-entry ledgers",
      "multi-currency accounting",
      "card authorisation",
      "receipt matching",
      "PostgreSQL",
    ],
    credentials: { affiliation: "Acme, Inc." },
    avatar: "avatarDaniel",
    account: "editor",
  },
  {
    key: "priya",
    slug: "priya-raghavan",
    name: "Priya Raghavan",
    jobTitle: "Fractional Controller",
    bioMd:
      "Priya is a fractional controller who closes the books for six venture-backed companies " +
      "and has opinions about all of them. She contributes the guides on accruals, audit " +
      "preparation and the accounting treatment questions that come up whenever a card " +
      "programme grows past its first fifty holders.",
    url: "https://priyaraghavan.co",
    sameAs: ["https://www.linkedin.com/in/priyaraghavan", "https://priyaraghavan.co"],
    knowsAbout: ["accruals", "audit readiness", "revenue recognition", "GAAP", "SOC 2"],
    credentials: { hasCredential: "CPA", alumniOf: "Boston College" },
    avatar: "avatarPriya",
  },
  {
    /**
     * Deliberately thin.
     *
     * Three complete profiles make the completeness meter a row of full bars,
     * which demonstrates nothing. Tom is what a real author record looks like
     * three minutes after somebody created it, and he is here so the meter, the
     * checklist and the "one profile link is a claim" advice all have something
     * true to say on a screenshot.
     */
    key: "tom",
    slug: "tom-brennan",
    name: "Tom Brennan",
    jobTitle: "Content Marketing",
  },
];

export const categories: CategoryFixture[] = [
  {
    key: "guides",
    slug: "guides",
    name: "Guides",
    description:
      "Long-form, practical writing for the person who has to make the decision this week.",
    position: 0,
  },
  {
    key: "product",
    slug: "product",
    name: "Product",
    description: "What we built, why it works the way it does, and what it deliberately does not do.",
    position: 1,
  },
  {
    key: "engineering",
    slug: "engineering",
    name: "Engineering",
    description: "How the ledger, the card rails and the matching engine are actually put together.",
    position: 2,
  },
  {
    key: "customer-stories",
    slug: "customer-stories",
    name: "Customer stories",
    description: "Finance teams describing what changed, with the numbers they were willing to share.",
    position: 3,
  },
];

export const tags: TagFixture[] = [
  {
    key: "expense-policy",
    slug: "expense-policy",
    name: "Expense policy",
    description: "Writing, enforcing and revising the rules people spend against.",
  },
  {
    key: "corporate-cards",
    slug: "corporate-cards",
    name: "Corporate cards",
    description: "Issuing, limiting and reconciling company cards.",
  },
  {
    key: "month-end-close",
    slug: "month-end-close",
    name: "Month-end close",
    description: "Everything between period end and a set of books somebody has signed off.",
  },
  {
    key: "soc-2",
    slug: "soc-2",
    name: "SOC 2",
    description: "Security and availability attestation, and what it does and does not cover.",
  },
  {
    key: "approvals",
    slug: "approvals",
    name: "Approvals",
    description: "Routing, thresholds and the delegation rules behind them.",
  },
  {
    key: "reimbursements",
    slug: "reimbursements",
    name: "Reimbursements",
    description: "Out-of-pocket spend, and paying it back without a spreadsheet.",
  },
  {
    key: "accounts-payable",
    slug: "accounts-payable",
    name: "Accounts payable",
    description: "Vendor invoices, payment runs and three-way matching.",
  },
  {
    key: "travel",
    slug: "travel",
    name: "Travel",
    description: "Booking, per diems and the policy questions travel raises first.",
  },
  {
    key: "audit",
    slug: "audit",
    name: "Audit",
    description: "Evidence, sampling and being ready before the request list arrives.",
  },
  {
    key: "integrations",
    slug: "integrations",
    name: "Integrations",
    description: "Syncing with the general ledger, the HRIS and the bank.",
  },
  {
    key: "api",
    slug: "api",
    name: "API",
    description: "Building against Acme programmatically.",
  },
  {
    key: "forecasting",
    slug: "forecasting",
    name: "Forecasting",
    description: "Turning commitments and run-rate into a number a budget owner can plan against.",
  },
];

/**
 * Entities, and the Q-numbers behind them.
 *
 * Every id below was resolved against the Wikidata API rather than recalled.
 * `acme` has none because Acme is not in Wikidata, and inventing one would
 * point every consuming answer engine at somebody else's subject — the exact
 * failure `sameAs` and `wikidataId` exist to prevent. Its `sameAs` names the
 * pages Acme actually controls, which is the honest reconciliation key.
 */
export const entities: EntityFixture[] = [
  {
    key: "expense-management",
    slug: "expense-management",
    name: "Expense management",
    type: "Thing",
    description: "The systems and policies a company uses to process and reimburse employee spend.",
    aliases: ["spend management", "T&E"],
    sameAs: ["https://en.wikipedia.org/wiki/Expense_management"],
    wikidataId: "Q5421010",
  },
  {
    key: "software-as-a-service",
    slug: "software-as-a-service",
    name: "Software as a service",
    type: "Thing",
    description: "Centrally hosted software licensed on subscription rather than sold outright.",
    aliases: ["SaaS"],
    sameAs: ["https://en.wikipedia.org/wiki/Software_as_a_service"],
    wikidataId: "Q1254596",
  },
  {
    key: "accounting",
    slug: "accounting",
    name: "Accounting",
    type: "Thing",
    description: "Measuring, processing and communicating the financial information of an entity.",
    sameAs: ["https://en.wikipedia.org/wiki/Accounting"],
    wikidataId: "Q4116214",
  },
  {
    key: "gaap",
    slug: "gaap",
    name: "Generally Accepted Accounting Principles",
    type: "Thing",
    description: "The standard framework of financial accounting rules used in a given jurisdiction.",
    aliases: ["GAAP", "US GAAP"],
    sameAs: ["https://en.wikipedia.org/wiki/Generally_accepted_accounting_principles"],
    wikidataId: "Q330153",
  },
  {
    key: "soc-2-reports",
    slug: "soc-2",
    name: "System and Organization Controls",
    type: "Thing",
    description: "The AICPA report family that includes SOC 2 Type I and Type II attestations.",
    aliases: ["SOC 2", "SOC 2 Type II", "SOC reports"],
    sameAs: ["https://en.wikipedia.org/wiki/System_and_organization_controls"],
    wikidataId: "Q86754369",
  },
  {
    key: "corporate-travel-management",
    slug: "corporate-travel-management",
    name: "Corporate travel management",
    type: "Thing",
    description: "The business function that plans, books and controls employee travel spend.",
    sameAs: ["https://en.wikipedia.org/wiki/Corporate_travel_management"],
    wikidataId: "Q2450555",
  },
  {
    key: "internal-control",
    slug: "internal-control",
    name: "Internal control",
    type: "Thing",
    description: "The processes an organisation uses to manage risk and reduce the chance of fraud.",
    sameAs: ["https://en.wikipedia.org/wiki/Internal_control"],
    wikidataId: "Q1667931",
  },
  {
    key: "corporate-card",
    slug: "corporate-card",
    name: "Corporate card",
    type: "Thing",
    description: "A payment card issued to an employee and settled by the employer.",
    aliases: ["company card", "purchasing card", "p-card"],
    sameAs: ["https://en.wikipedia.org/wiki/Credit_card"],
    wikidataId: "Q161380",
  },
  {
    key: "acme",
    slug: "acme",
    name: "Acme",
    type: "SoftwareApplication",
    description: "Acme's spend management platform: cards, expenses, approvals and accounts payable.",
    aliases: ["Acme Spend", "Acme, Inc."],
    /**
     * No Wikidata id, and none invented. Acme is not a subject Wikidata holds,
     * so the only URLs that genuinely identify it are the ones Acme publishes.
     */
    sameAs: ["https://acme.com", "https://www.linkedin.com/company/acme"],
    wikidataId: null,
  },
];

/** Hand-written rules. Slug history is written by `update_document`, not here. */
export const redirects = [
  {
    source: "/blog/expense-policy-guide",
    destination: "/blog/expense-policy-that-people-actually-follow",
    statusCode: 301 as const,
  },
  {
    source: "/pricing-2025",
    destination: "/pricing",
    statusCode: 301 as const,
  },
];
