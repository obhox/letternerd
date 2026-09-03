import type { AnchorHTMLAttributes } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CreateDocumentState } from "../create-document";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { NewDocumentForm } = await import("../new-document-form");

type Action = (state: CreateDocumentState, formData: FormData) => Promise<CreateDocumentState>;

function renderForm(action: Action) {
  render(<NewDocumentForm action={action} initialType="post" cancelHref="/acme/posts" />);
  return {
    title: screen.getByRole("textbox", { name: /title/i }),
    slug: screen.getByRole("textbox", { name: /slug/i }),
    description: screen.getByRole("textbox", { name: /description/i }),
    submit: screen.getByRole("button", { name: /create post/i }),
  };
}

/** An action that never resolves would leave the form pending; this one does. */
const succeeds: Action = async () => ({});

describe("NewDocumentForm", () => {
  describe("the slug", () => {
    it("follows the title until the author takes it over", async () => {
      const user = userEvent.setup();
      const { title, slug } = renderForm(succeeds);

      await user.type(title, "Héllo, World!");
      // Accents folded, punctuation collapsed to single hyphens: the form must
      // propose exactly what the capability's own pattern accepts, or the
      // suggestion is a guaranteed round trip.
      expect(slug).toHaveValue("hello-world");
    });

    it("stops following the title once the author has edited it", async () => {
      const user = userEvent.setup();
      const { title, slug } = renderForm(succeeds);

      await user.type(title, "Draft one");
      await user.clear(slug);
      await user.type(slug, "chosen-by-hand");
      await user.type(title, " revised");

      // For a document that has been published the slug *is* the URL, so
      // silently rewriting a deliberate choice is not a cosmetic overwrite.
      expect(slug).toHaveValue("chosen-by-hand");
    });

    it("resumes following the title when the author empties the field", async () => {
      const user = userEvent.setup();
      const { title, slug } = renderForm(succeeds);

      await user.type(title, "Draft one");
      await user.clear(slug);
      await user.type(slug, "mine");
      await user.clear(slug);
      await user.type(title, "!");

      // Otherwise emptying the field leaves the author with a permanently
      // blank slug they now have to type out by hand.
      expect(slug).toHaveValue("draft-one");
    });

    it("refuses a slug the capability would reject, without spending a round trip", async () => {
      const user = userEvent.setup();
      const action = vi.fn<Action>(async () => ({}));
      const { title, slug, submit } = renderForm(action);

      await user.type(title, "Draft one");
      await user.clear(slug);
      await user.type(slug, "Not A Slug");
      await user.click(submit);

      expect(action).not.toHaveBeenCalled();
      expect(await screen.findByText(/that slug is not valid/i)).toBeInTheDocument();
      // The error is useless if the person has to go and find the field.
      expect(slug).toHaveFocus();
    });

    it("flags an invalid slug on blur, before the author reaches the button", async () => {
      const user = userEvent.setup();
      const { title, slug } = renderForm(succeeds);

      await user.clear(slug);
      await user.type(slug, "Not A Slug");
      await user.click(title);

      expect(await screen.findByText(/that slug is not valid/i)).toBeInTheDocument();
    });
  });

  describe("after the server rejects the submission", () => {
    /**
     * Echoes back what the action normalised — the title trimmed, the type
     * resolved — alongside the reason it refused. This mirrors the real
     * `createDocumentAction`, which trims every field before validating.
     */
    const conflicts: Action = async (_state, formData) => ({
      values: {
        type: "post",
        title: String(formData.get("title") ?? "").trim(),
        slug: String(formData.get("slug") ?? "").trim(),
        description: String(formData.get("description") ?? "").trim(),
      },
      fieldErrors: {
        slug: '"my-post" is already taken by another post on this site. Choose a different slug.',
      },
    });

    it("shows the reason next to the field that caused it", async () => {
      const user = userEvent.setup();
      const { title, submit } = renderForm(conflicts);

      await user.type(title, "My post");
      await user.click(submit);

      const error = await screen.findByText(/already taken by another post/i);
      expect(error).toBeInTheDocument();
      // The field itself has to be marked invalid, or the control sounds fine
      // while outlined in red.
      expect(screen.getByRole("textbox", { name: /slug/i })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("keeps everything the author typed", async () => {
      const user = userEvent.setup();
      const { title, description, submit } = renderForm(conflicts);

      await user.type(title, "My post");
      await user.type(description, "A description worth keeping.");
      await user.click(submit);

      await screen.findByText(/already taken by another post/i);

      // The moment an author least deserves to lose four fields of typing.
      expect(screen.getByRole("textbox", { name: /title/i })).toHaveValue("My post");
      expect(screen.getByRole("textbox", { name: /slug/i })).toHaveValue("my-post");
      expect(screen.getByRole("textbox", { name: /description/i })).toHaveValue(
        "A description worth keeping.",
      );
    });

    it("reinstates the values the action normalised rather than the raw ones", async () => {
      const user = userEvent.setup();
      const { title, submit } = renderForm(conflicts);

      // Trailing whitespace is what the server trims. If the echoed values are
      // not applied, the form goes on showing a title the server has already
      // rewritten — and the next submit sends the stale one.
      await user.type(title, "  My post  ");
      await user.click(submit);

      await screen.findByText(/already taken by another post/i);
      expect(screen.getByRole("textbox", { name: /title/i })).toHaveValue("My post");
    });

    it("surfaces a failure that belongs to no single field as an alert", async () => {
      const user = userEvent.setup();
      const failing: Action = async () => ({
        message: "Your role on this site does not allow that.",
        values: { type: "post", title: "My post", slug: "my-post", description: "" },
      });
      const { title, submit } = renderForm(failing);

      await user.type(title, "My post");
      await user.click(submit);

      // `role="alert"` because focus has moved on by the time this arrives.
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your role on this site does not allow that.",
      );
    });
  });

  it("sends the document type along with the form, since the picker is not a native control", async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async () => ({}));
    const { title, submit } = renderForm(action);

    await user.type(title, "My post");
    await user.click(submit);

    expect(action).toHaveBeenCalledTimes(1);
    // Radix's Select is a listbox, so a hidden input is what actually reaches
    // the action. Without it the type silently defaults on every create.
    const formData = action.mock.calls[0]![1];
    expect(formData.get("type")).toBe("post");
    expect(formData.get("title")).toBe("My post");
    expect(formData.get("slug")).toBe("my-post");
  });
});
