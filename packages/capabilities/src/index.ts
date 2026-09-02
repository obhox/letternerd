/**
 * The capability registry.
 *
 * This module is the single source of truth for what the CMS can do. Every
 * transport — the MCP server, the REST API, the studio's server actions and
 * the CLI — imports this registry, resolves a capability by name and calls
 * `invoke`. None of them contains domain logic and none performs its own
 * authorization, so a feature added here is reachable everywhere at once.
 */

// Imported for its `declare module` augmentation, which is what gives handlers
// a typed `services`. Removing this import silently untypes every handler.
import "./services.js";

import { createRegistry } from "@cms/core";
import { documentCapabilities } from "./documents.js";
import { siteCapabilities } from "./sites.js";

export const capabilities = [...siteCapabilities, ...documentCapabilities];

export const registry = createRegistry(capabilities);

export * from "./documents.js";
export * from "./sites.js";
export * from "./render.js";
export * from "./shared.js";
export type { Database, StorageService } from "./services.js";
