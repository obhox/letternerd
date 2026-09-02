/**
 * What makes an author profile worth having, and why.
 *
 * Most author records in most CMSs are a name and nothing else, because
 * nothing in the interface ever explains what the other fields are for. So the
 * reason travels with the check: each item carries the sentence that says what
 * filling it in actually buys, and the screen shows that sentence next to the
 * field rather than hiding it in documentation nobody opens.
 *
 * These map to the `Person` node emitted in each document's JSON-LD. None of
 * them is a ranking factor on its own — the point is corroboration. A byline
 * that resolves to a real person with a job title, a body of work and profiles
 * elsewhere is one a reader and a machine can both check.
 */

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  /** Prose, addressed to the person filling the form in. */
  why: string;
}

export interface AuthorDraftLike {
  name: string;
  jobTitle: string | null;
  bioMd: string | null;
  avatarAssetId: string | null;
  url: string | null;
  sameAs: readonly string[];
  knowsAbout: readonly string[];
}

export interface Completeness {
  items: CompletenessItem[];
  done: number;
  total: number;
  /** 0–100, for the meter. */
  percent: number;
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function authorCompleteness(author: AuthorDraftLike): Completeness {
  const items: CompletenessItem[] = [
    {
      key: "name",
      label: "Display name",
      done: filled(author.name),
      why: "Person.name — the byline itself.",
    },
    {
      key: "jobTitle",
      label: "Job title",
      done: filled(author.jobTitle),
      why: "Person.jobTitle.",
    },
    {
      key: "bio",
      label: "Biography",
      done: filled(author.bioMd),
      why: "Person.description, and the body of the author page.",
    },
    {
      key: "avatar",
      label: "Photo",
      done: filled(author.avatarAssetId),
      why: "Person.image.",
    },
    {
      key: "sameAs",
      label: "Profile links",
      done: author.sameAs.filter((url) => filled(url)).length > 0,
      why: "Person.sameAs — profiles elsewhere that corroborate this identity.",
    },
    {
      key: "knowsAbout",
      label: "Topics",
      done: author.knowsAbout.filter((topic) => filled(topic)).length > 0,
      why: "Person.knowsAbout — the subjects this author has standing in.",
    },
    {
      key: "url",
      label: "Personal site",
      done: filled(author.url),
      why: "Person.url — a page they control.",
    },
  ];

  const done = items.filter((item) => item.done).length;
  return {
    items,
    done,
    total: items.length,
    percent: Math.round((done / items.length) * 100),
  };
}

/**
 * A second profile link is worth calling out separately.
 *
 * One link is an assertion; two independent ones that agree are evidence, and
 * the jump from one to two is the cheapest improvement available on this
 * screen. Kept out of the checklist so it reads as advice rather than as a
 * requirement someone must satisfy.
 */
export function sameAsAdvice(sameAs: readonly string[]): string | null {
  const count = sameAs.filter((url) => url.trim().length > 0).length;
  if (count === 0) return null;
  if (count === 1) {
    return "One profile link is a claim. Two independent ones are corroboration.";
  }
  return null;
}
