import { z } from "zod";
import type { AnyCapability } from "./capability";

/**
 * Turn a capability's Zod schema into what the MCP SDK wants.
 *
 * `registerTool` takes a raw shape — an object of field schemas — rather than
 * the assembled `ZodObject`, because it builds the JSON Schema itself. Most
 * capabilities declare a plain object, but any that adds a cross-field rule via
 * `.refine()` is wrapped in a `ZodEffects`, and reaching for `.shape` on one of
 * those returns undefined. The tool would then register with no parameters at
 * all and silently accept anything, which is a far worse failure than a crash.
 *
 * That failure is not hypothetical: handing the SDK a schema it cannot reduce
 * to a shape produces `{"type":"object","properties":{}}` — a tool that
 * advertises no arguments and rejects every call the agent makes at the
 * capability's own parse, with no hint in the tool list about what it wanted.
 * So anything unrecognised throws here, loudly, at startup.
 *
 * This lives in core, beside `mcpAnnotations`, because every transport needs
 * it and two copies is how they diverge. They already had: one rejected the
 * discriminated union `upsert_term` declares, so the stdio server exited at
 * startup while the HTTP one served all 45 tools. A shared module makes that
 * class of failure impossible rather than merely unlikely.
 */
export function rawShapeOf(cap: AnyCapability): z.ZodRawShape {
  const unwrapped = unwrap(cap.input);

  if (unwrapped instanceof z.ZodObject) {
    return unwrapped.shape as z.ZodRawShape;
  }

  if (unwrapped instanceof z.ZodDiscriminatedUnion) {
    return flattenVariants(unwrapped);
  }

  throw new Error(
    `Capability "${cap.name}" must declare an object or discriminated-union input; got ` +
      `${unwrapped._def.typeName}. Registering it as-is would advertise a tool with no ` +
      "arguments.",
  );
}

/**
 * A discriminated union, flattened into one advertised shape.
 *
 * JSON Schema can express a union — `anyOf` over the branches — but an MCP tool
 * input must be an object, and the SDK's shape-based path cannot carry one. The
 * alternative to flattening is not a more precise schema; it is a tool with no
 * parameters at all, which is what the SDK produces when handed a union.
 *
 * So the branches are merged: fields every branch shares keep their own
 * schemas, fields only some branches carry become optional, and the
 * discriminator becomes an enum of the branch names with a description saying
 * which extra fields belong to which. This is looser than the real rule, and
 * deliberately so — the real rule is still enforced, by `capability.invoke`,
 * which parses against the untouched union and answers `invalid_input` with the
 * failing paths. The advertised schema is for an agent choosing arguments; the
 * declared schema is what decides whether they were right.
 */
function flattenVariants(union: z.ZodTypeAny): z.ZodRawShape {
  const { discriminator, options } = union._def as {
    discriminator: string;
    options: z.ZodObject<z.ZodRawShape>[];
  };

  const occurrences = new Map<string, number>();
  const merged: z.ZodRawShape = {};

  for (const option of options) {
    for (const [field, schema] of Object.entries(option.shape)) {
      occurrences.set(field, (occurrences.get(field) ?? 0) + 1);
      // First branch wins. Shared fields are declared identically across
      // branches in practice; where they are not, the looser advertised type
      // costs nothing because `invoke` re-parses against the real union.
      merged[field] ??= schema;
    }
  }

  const shared = (field: string) => occurrences.get(field) === options.length;

  const variants = options.map((option) => {
    const value = (option.shape[discriminator] as z.ZodLiteral<string>).value;
    const extras = Object.keys(option.shape).filter(
      (field) => field !== discriminator && !shared(field),
    );
    return { value, extras };
  });

  for (const field of occurrences.keys()) {
    if (field !== discriminator && !shared(field)) {
      merged[field] = (merged[field] as z.ZodTypeAny).optional();
    }
  }

  const notes = variants
    .filter((variant) => variant.extras.length > 0)
    .map((variant) => `${variant.value}: ${variant.extras.join(", ")}`);

  merged[discriminator] = z
    .enum(variants.map((variant) => variant.value) as [string, ...string[]])
    .describe(
      notes.length > 0
        ? `Selects the variant. Fields only some variants accept — ${notes.join("; ")}.`
        : "Selects the variant.",
    );

  return merged;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  // .refine()/.superRefine() nest; .default()/.optional() should not appear at
  // the top level of a tool input but are cheap to see through.
  for (let depth = 0; depth < 10; depth++) {
    if (current instanceof z.ZodEffects) {
      current = current.innerType();
      continue;
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
      current = current._def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return current;
}
