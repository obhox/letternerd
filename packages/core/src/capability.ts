import { z } from "zod";
import type { Actor, Scope } from "./actor.js";
import { assertRole, assertScope } from "./actor.js";
import type { SiteRole } from "./roles.js";
import { invalidInput } from "./errors.js";

/**
 * The capability layer.
 *
 * This is the whole point of the architecture. Every domain operation is
 * defined exactly once, here, with its input schema and its authorization
 * requirements attached. The MCP server, the REST API, the studio's server
 * actions and the CLI are four thin transports that dispatch into this
 * registry — none of them contains business logic, and none of them performs
 * its own authorization.
 *
 * The failure mode this exists to prevent is the usual one: an MCP server
 * bolted on top of an HTTP API, forever one feature behind, with a subtly
 * different permission check. Here, adding a capability makes it reachable
 * from every transport by construction, and `assertRegistryParity` in the
 * test suite fails the build if a transport ever stops covering one.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Everything a handler is allowed to reach for.
 *
 * Declared as an interface so it can be augmented rather than imported
 * circularly — `@cms/db` and friends extend this in their own modules, which
 * keeps `@cms/core` at the root of the dependency graph with no dependencies
 * of its own.
 */
export interface CapabilityServices {
  // Augmented in Phase 1: db, storage, renderer, mailer, clock.
  // Intentionally empty here so `@cms/core` depends on nothing.
  readonly _brand?: never;
}

export interface CapabilityContext {
  readonly actor: Actor;
  readonly services: CapabilityServices;
}

export interface CapabilityDef<I extends z.ZodTypeAny, O> {
  /** snake_case. Becomes the MCP tool name verbatim. */
  name: string;
  /** Human title for the MCP tool list and the studio's command palette. */
  title: string;
  /**
   * Written for an agent deciding whether to call it, not for a changelog.
   * Say what it does, what it refuses to do, and what it costs.
   */
  description: string;
  input: I;
  scopes: readonly Scope[];
  /** Minimum site role. Ownership checks happen inside the handler. */
  role: SiteRole;

  /** MCP tool annotations. Defaults are the conservative ones. */
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;

  /** REST binding. Every capability has one; the parity test enforces it. */
  route: { method: HttpMethod; path: string };

  handler: (input: z.infer<I>, ctx: CapabilityContext) => Promise<O>;
}

/**
 * A defined capability, ready to dispatch.
 *
 * Deliberately does NOT expose `handler`. `invoke` is the only entry point, so
 * a transport cannot reach past the authorization checks — and leaving the
 * handler off the public type is also what keeps `Capability<Specific>`
 * assignable to `AnyCapability`, since a handler's parameter is contravariant.
 */
export interface Capability<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: I;
  readonly scopes: readonly Scope[];
  readonly role: SiteRole;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly route: { method: HttpMethod; path: string };
  invoke(rawInput: unknown, ctx: CapabilityContext): Promise<O>;
}

/**
 * The erased form the registry and every transport hold.
 *
 * Transports are generic over nothing — they take a name off the wire, look it
 * up, and invoke it with unparsed input. Only the capability itself knows its
 * own types, which is exactly the boundary we want.
 */
export type AnyCapability = Capability<z.ZodTypeAny, unknown>;

export function defineCapability<I extends z.ZodTypeAny, O>(
  def: CapabilityDef<I, O>,
): Capability<I, O> {
  const { handler, ...meta } = def;
  return {
    ...meta,
    async invoke(rawInput: unknown, ctx: CapabilityContext): Promise<O> {
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) {
        throw invalidInput(`Invalid input for "${def.name}".`, {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }

      // Central, unskippable. A handler never checks its own permissions.
      for (const scope of def.scopes) assertScope(ctx.actor, scope);
      assertRole(ctx.actor, def.role);

      return handler(parsed.data as z.infer<I>, ctx);
    },
  };
}

/** A registry is just a name-keyed map, built once at module load. */
export type CapabilityRegistry = ReadonlyMap<string, AnyCapability>;

export function createRegistry(capabilities: readonly AnyCapability[]): CapabilityRegistry {
  const map = new Map<string, AnyCapability>();
  for (const cap of capabilities) {
    if (map.has(cap.name)) {
      throw new Error(`Duplicate capability name: "${cap.name}".`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(cap.name)) {
      throw new Error(
        `Capability "${cap.name}" must be snake_case — it is used verbatim as an MCP tool name.`,
      );
    }
    map.set(cap.name, cap);
  }
  return map;
}

/**
 * MCP tool annotations derived from the definition.
 *
 * Kept here rather than in the MCP transport so that the annotation an agent
 * sees and the check the capability performs come from one declaration.
 */
export function mcpAnnotations(cap: AnyCapability) {
  return {
    title: cap.title,
    readOnlyHint: cap.readOnly ?? false,
    destructiveHint: cap.destructive ?? !(cap.readOnly ?? false),
    idempotentHint: cap.idempotent ?? false,
    openWorldHint: false,
  };
}
