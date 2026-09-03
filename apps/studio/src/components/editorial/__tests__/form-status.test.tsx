import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { failed, INITIAL_STATE, succeeded } from "../action-state";
import { FormStatus } from "../form-status";

/**
 * Three outcomes, drawn as three different interruptions.
 *
 * The roles are the substance here, not decoration. A failure arrives after
 * the submit, when focus has already moved on, so it has to be `role="alert"`
 * or the person never learns the save did not happen. A success that carries a
 * caveat is `role="status"` — the save worked, and interrupting for something
 * that is not a failure trains people to ignore the interruption.
 */
describe("FormStatus", () => {
  it("says nothing before anything has been submitted", () => {
    render(<FormStatus state={INITIAL_STATE} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a failure as an alert", () => {
    render(<FormStatus state={failed("Your role on this site does not allow that.")} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your role on this site does not allow that.",
    );
    // Not a status: a status is polite and may never reach the person at all.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a plain success politely", () => {
    render(<FormStatus state={succeeded("Redirect saved.")} />);

    expect(screen.getByRole("status")).toHaveTextContent("Redirect saved.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists warnings on a save that succeeded, without calling it a failure", () => {
    render(
      <FormStatus
        state={succeeded("Redirect saved.", [
          "This redirect creates a chain through /old-path.",
          "The destination is itself redirected.",
        ])}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved, with something worth checking");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(status).toHaveTextContent("This redirect creates a chain through /old-path.");
    // Warnings are not failures, and announcing them as such would make the
    // author think the save did not happen.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not repeat the one-line confirmation alongside the warnings", () => {
    // Two success messages stacked is noise; the warning panel already says
    // the save went through.
    render(<FormStatus state={succeeded("Redirect saved.", ["A chain was created."])} />);
    expect(screen.queryByText("Redirect saved.")).not.toBeInTheDocument();
  });
});

/**
 * The message an action shows for a capability failure. Two codes are
 * rewritten because their own text is aimed at an API caller; every other
 * message is already written for a person and would only be made worse.
 */
describe("messageFor", () => {
  it("replaces the codes whose wording is aimed at an API caller", async () => {
    const { messageFor } = await import("../action-state");

    expect(messageFor({ code: "forbidden", message: "Requires role editor." })).toBe(
      "Your role on this site does not allow that.",
    );
    expect(messageFor({ code: "not_found", message: "No such author." })).toBe(
      "That item no longer exists. Reload the page and try again.",
    );
  });

  it("keeps a message that was already written for a person", async () => {
    const { messageFor } = await import("../action-state");

    // The deletion refusal names the author and the count. Replacing it with a
    // generic sentence would throw away the only part worth reading.
    expect(
      messageFor({
        code: "conflict",
        message: "Ada Lovelace is the author of 12 documents. Reassign them first.",
      }),
    ).toBe("Ada Lovelace is the author of 12 documents. Reassign them first.");
  });
});
