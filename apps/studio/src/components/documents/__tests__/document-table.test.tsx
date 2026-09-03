import type { AnchorHTMLAttributes } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSummary } from "../types";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DocumentTable } = await import("../document-table");

/** One row, with only the fields a test cares about spelled out. */
function row(overrides: Partial<DocumentSummary> & Pick<DocumentSummary, "id" | "title">): DocumentSummary {
  return {
    type: "post",
    status: "draft",
    slug: overrides.title.toLowerCase().replaceAll(" ", "-"),
    description: null,
    publishedAt: null,
    updatedAt: "2026-08-01T10:00:00.000Z",
    readingTimeMinutes: 3,
    wordCount: 600,
    lintReport: {},
    ...overrides,
  } as DocumentSummary;
}

function renderTable(rows: DocumentSummary[], props: Partial<Parameters<typeof DocumentTable>[0]> = {}) {
  return render(
    <DocumentTable
      rows={rows}
      siteSlug="acme"
      caption="Posts"
      emptyTitle="No posts yet"
      emptyDescription="Articles that appear in feeds, the sitemap and llms.txt."
      {...props}
    />,
  );
}

/** The `<tr>` a given document's title link sits in. */
function rowFor(title: string): HTMLElement {
  const link = screen.getByRole("link", { name: title });
  const tr = link.closest("tr");
  if (!tr) throw new Error(`No row found for "${title}"`);
  return tr;
}

beforeEach(() => {
  push.mockReset();
});

describe("DocumentTable", () => {
  it("renders one row per document, each linking to its editor", () => {
    renderTable([row({ id: "1", title: "First post" }), row({ id: "2", title: "Second post" })]);

    // A real link, not only the row click: this is what middle-click, "open in
    // new tab" and sequential keyboard navigation need.
    expect(screen.getByRole("link", { name: "First post" })).toHaveAttribute(
      "href",
      "/acme/posts/1",
    );
    expect(screen.getByRole("link", { name: "Second post" })).toHaveAttribute(
      "href",
      "/acme/posts/2",
    );
    // Two documents plus the header row.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("labels an untitled document rather than rendering an empty link", () => {
    // A document created and never named still has to be reachable; an empty
    // <a> is a link with no accessible name and no click target.
    renderTable([row({ id: "1", title: "" })]);
    expect(screen.getByRole("link", { name: "Untitled" })).toBeInTheDocument();
  });

  it("navigates when a row is clicked", async () => {
    const user = userEvent.setup();
    renderTable([row({ id: "1", title: "First post" })]);

    await user.click(within(rowFor("First post")).getByText("/first-post"));

    expect(push).toHaveBeenCalledWith("/acme/posts/1");
  });

  describe("the lint column", () => {
    beforeEach(() => {
      renderTable([
        row({ id: "1", title: "Never checked", lintReport: {} }),
        row({ id: "2", title: "Checked and clean", lintReport: { findings: [] } }),
        row({
          id: "3",
          title: "Has errors",
          lintReport: {
            findings: [
              { rule: "missing-alt", severity: "error", message: "No alt text." },
              { rule: "missing-alt", severity: "error", message: "No alt text." },
            ],
          },
        }),
      ]);
    });

    /**
     * The distinction the whole column exists for. "Nobody has looked" and
     * "we looked and it was fine" both have zero findings, and drawing them
     * the same way promises an editor a review that never happened.
     */
    it("marks a document nobody has checked as not checked", () => {
      const cell = rowFor("Never checked");
      expect(within(cell).getByText("Not checked")).toBeInTheDocument();
      expect(within(cell).queryByText(/no lint problems/i)).not.toBeInTheDocument();
    });

    it("marks a document that was checked and found clean as clean", () => {
      const cell = rowFor("Checked and clean");
      expect(within(cell).getByText(/checked, no lint problems/i)).toBeInTheDocument();
      expect(within(cell).queryByText("Not checked")).not.toBeInTheDocument();
    });

    it("shows the error count, described in words for assistive technology", () => {
      const cell = rowFor("Has errors");
      // The numeral is the glance; the sentence is what survives being read
      // aloud or printed.
      expect(within(cell).getByText("2 errors")).toBeInTheDocument();
    });
  });

  describe("the author column", () => {
    it("is hidden while no row carries a byline", () => {
      // `search_content` returns no byline today. A column of dashes costs
      // horizontal space on a dense screen and teaches readers to skip that
      // position.
      renderTable([row({ id: "1", title: "First post" })]);
      expect(screen.queryByRole("columnheader", { name: "Author" })).not.toBeInTheDocument();
    });

    it("appears as soon as one row carries a byline", () => {
      renderTable([
        row({ id: "1", title: "First post", authorName: "Ada Lovelace" }),
        row({ id: "2", title: "Second post" }),
      ]);
      expect(screen.getByRole("columnheader", { name: "Author" })).toBeInTheDocument();
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    });
  });

  describe("when there is nothing to show", () => {
    it("explains the empty list and offers the action", () => {
      renderTable([], { emptyAction: <button type="button">New post</button> });

      expect(screen.getByText("No posts yet")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New post" })).toBeInTheDocument();
    });

    it("does not claim the list is empty while it is still loading", () => {
      // The flash of "No posts yet" on a site full of posts is the worst
      // possible thing to say during a load.
      renderTable([], { loading: true });
      expect(screen.queryByText("No posts yet")).not.toBeInTheDocument();
    });
  });

  it("describes itself to assistive technology", () => {
    renderTable([row({ id: "1", title: "First post" })], { caption: "Posts on acme" });
    expect(screen.getByRole("table", { name: "Posts on acme" })).toBeInTheDocument();
  });
});
