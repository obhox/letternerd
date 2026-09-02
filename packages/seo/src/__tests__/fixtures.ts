import type { SeoAuthor, SeoDocument, SeoSite } from "../types.js";

export const site: SeoSite = {
  baseUrl: "https://spendtab.com",
  blogBasePath: "/blog",
  name: "Spendtab",
  locale: "en-GB",
  orgName: "Spendtab Ltd",
  orgLogoUrl: "/logo.png",
  orgSameAs: ["https://x.com/spendtab", "https://www.linkedin.com/company/spendtab"],
  twitterHandle: "spendtab",
  feedTitle: "The Spendtab Blog",
  feedDescription: "Spend management, explained.",
  robotsExtra: "Disallow: /internal/",
  llmsIntro: "Spendtab is spend management for finance teams.",
};

export const author: SeoAuthor = {
  name: "Jane Doe",
  slug: "jane-doe",
  jobTitle: "Head of Finance Operations",
  bio: "Writes about spend controls and month-end close.",
  avatarUrl: "/media/jane.jpg",
  sameAs: ["https://www.linkedin.com/in/janedoe"],
  knowsAbout: ["Spend management", "Procurement"],
};

export const bodyText = [
  "An expense policy is the set of rules that decides what a company will pay for.",
  "",
  "## How do I write an expense policy?",
  "",
  "Start from the three or four categories that account for most of your spend, and",
  "write a limit for each.",
  "",
  "## What should a policy leave out?",
  "",
  "Anything you are not willing to enforce.",
].join("\n");

export const doc: SeoDocument = {
  slug: "expense-policies",
  title: "How to write an expense policy",
  description: "A short guide to writing a policy people actually follow.",
  excerpt: "Start with the categories that matter.",
  bodyHtml: "<p>An expense policy is the set of rules that decides what a company will pay for.</p>",
  bodyText,
  publishedAt: "2025-03-04T09:00:00.000Z",
  dateModified: "2025-06-01T12:30:00.000Z",
  author,
  category: { name: "Finance Ops", slug: "finance-ops" },
  tags: [
    { name: "Policy", slug: "policy" },
    { name: "Controls", slug: "controls" },
  ],
  entities: [
    { name: "Expense policy", wikidataId: "Q5421100", isPrimary: true },
    { name: "Procurement", sameAs: ["https://en.wikipedia.org/wiki/Procurement"] },
  ],
  coverImage: { url: "/media/cover.jpg", width: 1600, height: 900, alt: "A policy document" },
  ogImage: { url: "/media/og.png", width: 1200, height: 630 },
  qa: [
    {
      question: "How do I write an expense policy?",
      answerText:
        "Start from the three or four categories that account for most of your spend, and write a limit for each.",
      anchorId: "how-do-i-write-an-expense-policy",
    },
  ],
  howTo: {
    name: "Write an expense policy",
    description: "Four steps from a blank page to a policy people follow.",
    steps: [
      { name: "List your categories", text: "Pull last quarter's spend and group it." },
      { name: "Set a limit per category", text: "Pick a number you will actually enforce." },
    ],
  },
  wordCount: 1240,
  readingTimeMinutes: 6,
  tldr: "Write limits for the categories that matter and enforce them.",
  keyTakeaways: ["Start from real spend", "Only write rules you will enforce"],
};

/** A second document, minimal and uncategorised, for grouping and fallback paths. */
export const draftish: SeoDocument = {
  slug: "receipts",
  title: "Receipts, briefly",
  publishedAt: "2025-01-02T00:00:00.000Z",
};
