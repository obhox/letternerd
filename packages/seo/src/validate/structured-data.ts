import { HEADLINE_MAX } from "../jsonld/blog-posting.js";

/**
 * Hand-written checks against Google's documented requirements.
 *
 * There is no schema library here on purpose. Google's structured-data
 * requirements are not a schema — they are a short, specific and frequently
 * revised list of "required", "recommended" and "must match the visible page",
 * and the last of those cannot be expressed in JSON Schema at all. Writing
 * them out means each rule can carry the sentence an editor needs to fix it,
 * and means the FAQ answer-in-body check can exist.
 *
 * The severity split is the contract with the publish pipeline: an `error` is
 * something Google will reject or, worse, treat as a policy violation across
 * the whole site, so it blocks publishing. A `warning` is a missed
 * opportunity, and an editor is allowed to ship without it.
 */

export interface ValidationIssue {
  /** The structured-data type the issue was found in, e.g. `BlogPosting`. */
  type: string;
  /** Dotted path to the offending property, where one exists. */
  property?: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationContext {
  /**
   * The rendered body as a reader sees it, with markup stripped.
   *
   * Supplied so FAQ answers can be checked against it. Google's policy is
   * explicit that FAQ markup must reproduce content visible on the page, and
   * markup-only answers are the single most common cause of a manual action
   * on this feature.
   */
  bodyText?: string | null;
}

/** True when any issue must stop a publish. */
export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/* ---------------------------------------------------------------- helpers -- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * ISO-8601, as Google means it: a date or a date-time, optionally zoned.
 *
 * `Date.parse` alone is far too permissive — it accepts "March 3 2024", which
 * a crawler does not — so the shape is checked first and the parse only
 * confirms the numbers are real.
 */
export function isIso8601(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/** Collapses whitespace and case so a comparison survives re-flowed markup. */
function normalizeForComparison(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .toLowerCase();
}

function imageIsPresent(value: unknown): boolean {
  if (nonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.some(imageIsPresent);
  if (isRecord(value)) return nonEmptyString(value["url"]);
  return false;
}

/* ------------------------------------------------------------- validators -- */

function validateBlogPosting(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  type: string,
): void {
  const push = (
    severity: ValidationIssue["severity"],
    property: string,
    message: string,
  ): void => {
    issues.push({ type, property, severity, message });
  };

  const headline = payload["headline"];
  if (!nonEmptyString(headline)) {
    push("error", "headline", "A headline is required. Give the document a title.");
  } else if (headline.length > HEADLINE_MAX) {
    push(
      "warning",
      "headline",
      `Headline is ${headline.length} characters; Google truncates past ${HEADLINE_MAX}.`,
    );
  }

  if (!imageIsPresent(payload["image"])) {
    push(
      "error",
      "image",
      "An image is required. Set a cover or social image at least 1200px wide.",
    );
  }

  const datePublished = payload["datePublished"];
  if (!nonEmptyString(datePublished)) {
    push("error", "datePublished", "A publication date is required.");
  } else if (!isIso8601(datePublished)) {
    push(
      "error",
      "datePublished",
      `datePublished must be ISO-8601, got "${String(datePublished)}".`,
    );
  }

  const dateModified = payload["dateModified"];
  if (dateModified !== undefined && !isIso8601(dateModified)) {
    push("error", "dateModified", `dateModified must be ISO-8601, got "${String(dateModified)}".`);
  }

  const author = payload["author"];
  const authorNodes = Array.isArray(author) ? author : author === undefined ? [] : [author];
  if (authorNodes.length === 0) {
    push("error", "author", "An author is required.");
  }
  for (const node of authorNodes) {
    if (!isRecord(node)) {
      // The bare-string author is the specific failure this rule exists for:
      // it is accepted by nothing, and it throws away every credibility
      // signal the author record already holds.
      push("error", "author", "Author must be a Person node with @type, not a bare name.");
      continue;
    }
    if (!nonEmptyString(node["@type"])) {
      push("error", "author.@type", "Author node is missing @type.");
    }
    if (!nonEmptyString(node["name"])) {
      push("error", "author.name", "Author node is missing a name.");
    }
    if (!Array.isArray(node["sameAs"]) || node["sameAs"].length === 0) {
      push(
        "warning",
        "author.sameAs",
        "Author has no sameAs profiles; these are the strongest available E-E-A-T signal.",
      );
    }
  }

  if (!isRecord(payload["publisher"])) {
    push("warning", "publisher", "No publisher Organization; set the site's organisation name.");
  }
  if (!nonEmptyString(payload["description"])) {
    push("warning", "description", "No description; search results will use an extracted snippet.");
  }
  if (!nonEmptyString(payload["inLanguage"])) {
    push("warning", "inLanguage", "No inLanguage; set the site's locale.");
  }
}

function validateFaqPage(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  type: string,
  ctx: ValidationContext,
): void {
  const entries = payload["mainEntity"];
  if (!Array.isArray(entries) || entries.length === 0) {
    issues.push({
      type,
      property: "mainEntity",
      severity: "error",
      message: "FAQPage requires at least one question.",
    });
    return;
  }

  const body = ctx.bodyText ? normalizeForComparison(ctx.bodyText) : null;

  entries.forEach((entry, index) => {
    const at = `mainEntity[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ type, property: at, severity: "error", message: "Question must be an object." });
      return;
    }

    if (!nonEmptyString(entry["name"])) {
      issues.push({
        type,
        property: `${at}.name`,
        severity: "error",
        message: "Question text is empty.",
      });
    }

    const answer = entry["acceptedAnswer"];
    const answerText = isRecord(answer) ? answer["text"] : undefined;
    if (!nonEmptyString(answerText)) {
      issues.push({
        type,
        property: `${at}.acceptedAnswer.text`,
        severity: "error",
        message: "Answer text is empty.",
      });
      return;
    }

    if (body && !body.includes(normalizeForComparison(answerText))) {
      issues.push({
        type,
        property: `${at}.acceptedAnswer.text`,
        severity: "error",
        message:
          "Answer does not appear in the visible page body. Google requires FAQ answers to be " +
          "readable on the page; markup-only answers risk a manual action.",
      });
    }
  });
}

function validateHowTo(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  type: string,
): void {
  if (!nonEmptyString(payload["name"])) {
    issues.push({ type, property: "name", severity: "error", message: "HowTo requires a name." });
  }

  const steps = payload["step"];
  if (!Array.isArray(steps) || steps.length < 2) {
    issues.push({
      type,
      property: "step",
      severity: "error",
      message: `HowTo requires at least 2 steps, got ${Array.isArray(steps) ? steps.length : 0}.`,
    });
    return;
  }

  steps.forEach((step, index) => {
    const at = `step[${index}]`;
    if (!isRecord(step) || !nonEmptyString(step["name"])) {
      issues.push({
        type,
        property: `${at}.name`,
        severity: "error",
        message: "Every HowTo step needs a name.",
      });
    }
    if (isRecord(step) && !nonEmptyString(step["text"])) {
      issues.push({
        type,
        property: `${at}.text`,
        severity: "warning",
        message: "Step has no text; the name alone rarely explains the step.",
      });
    }
  });
}

function validateSpeakable(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  type: string,
): void {
  // Accepts either the SpeakableSpecification itself or the WebPage carrying it.
  const spec = isRecord(payload["speakable"]) ? payload["speakable"] : payload;
  const selectors = spec["cssSelector"];
  const xpath = spec["xpath"];

  const hasSelector =
    (Array.isArray(selectors) && selectors.some(nonEmptyString)) ||
    nonEmptyString(selectors) ||
    (Array.isArray(xpath) && xpath.some(nonEmptyString)) ||
    nonEmptyString(xpath);

  if (!hasSelector) {
    issues.push({
      type,
      property: "speakable.cssSelector",
      severity: "error",
      message: "Speakable requires at least one cssSelector or xpath.",
    });
  }
}

function validateOrganization(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  type: string,
): void {
  if (!nonEmptyString(payload["name"])) {
    issues.push({ type, property: "name", severity: "error", message: "Organization needs a name." });
  }
  if (!nonEmptyString(payload["url"])) {
    issues.push({ type, property: "url", severity: "error", message: "Organization needs a url." });
  }
  if (!payload["logo"]) {
    issues.push({
      type,
      property: "logo",
      severity: "warning",
      message: "No logo; publisher logos appear in several result types.",
    });
  }
}

function validateBreadcrumbList(
  payload: Record<string, unknown>,
  issues: ValidationIssue[],
  type: string,
): void {
  const items = payload["itemListElement"];
  if (!Array.isArray(items) || items.length === 0) {
    issues.push({
      type,
      property: "itemListElement",
      severity: "error",
      message: "BreadcrumbList requires at least one item.",
    });
    return;
  }

  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (typeof item["position"] !== "number") {
      issues.push({
        type,
        property: `itemListElement[${index}].position`,
        severity: "error",
        message: "Breadcrumb items must carry a numeric position.",
      });
    }
    if (!nonEmptyString(item["name"])) {
      issues.push({
        type,
        property: `itemListElement[${index}].name`,
        severity: "error",
        message: "Breadcrumb items must be named.",
      });
    }
  });
}

/**
 * Dispatch on the declared type rather than on `payload["@type"]`.
 *
 * The caller knows what it asked for. Trusting the payload's own `@type` would
 * mean a node that lost its type silently passes every check by matching no
 * validator, which is the opposite of what a validator is for.
 */
export function validateStructuredData(
  type: string,
  payload: unknown,
  ctx: ValidationContext = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isRecord(payload)) {
    return [
      {
        type,
        severity: "error",
        message: "Structured data payload is not an object.",
      },
    ];
  }

  switch (type) {
    case "BlogPosting":
    case "Article":
    case "NewsArticle":
      validateBlogPosting(payload, issues, type);
      break;
    case "FAQPage":
      validateFaqPage(payload, issues, type, ctx);
      break;
    case "HowTo":
      validateHowTo(payload, issues, type);
      break;
    case "Speakable":
    case "SpeakableSpecification":
      validateSpeakable(payload, issues, type);
      break;
    case "Organization":
      validateOrganization(payload, issues, type);
      break;
    case "BreadcrumbList":
      validateBreadcrumbList(payload, issues, type);
      break;
    default:
      // Unknown types are not an error — the studio may emit markup this
      // package has no opinion about — but silence would look like a pass.
      issues.push({
        type,
        severity: "warning",
        message: `No validator for "${type}"; the markup was not checked.`,
      });
  }

  return issues;
}
