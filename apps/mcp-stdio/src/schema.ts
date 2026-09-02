import { z } from "zod";
import type { AnyCapability } from "@cms/core";

/**
 * Turn a capability's Zod schema into what the MCP SDK wants.
 *
 * `registerTool` takes a raw shape — an object of field schemas — rather than
 * the assembled `ZodObject`, because it builds the JSON Schema itself. Most
 * capabilities declare a plain object, but any that adds a cross-field rule via
 * `.refine()` is wrapped in a `ZodEffects`, and reaching for `.shape` on one of
 * those returns undefined. The tool would then register with no parameters at
 * all and silently accept anything, which is a far worse failure than a crash.
 */
export function rawShapeOf(cap: AnyCapability): z.ZodRawShape {
  const unwrapped = unwrap(cap.input);
  if (unwrapped instanceof z.ZodObject) {
    return unwrapped.shape as z.ZodRawShape;
  }
  throw new Error(
    `Capability "${cap.name}" must declare an object input; got ${unwrapped._def.typeName}.`,
  );
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
