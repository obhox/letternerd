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
import "./services";

import { createRegistry } from "@cms/core";
import { connectionsCapabilities } from "./connections";
import { documentCapabilities } from "./documents";
import { editorialCapabilities } from "./editorial";
import { insightsCapabilities } from "./insights";
import { installCapabilities } from "./install";
import { mediaCapabilities } from "./media";
import { schedulerCapabilities } from "./scheduler";
import { settingsCapabilities } from "./settings";
import { siteCapabilities } from "./sites";

export const capabilities = [
  ...siteCapabilities,
  ...documentCapabilities,
  ...mediaCapabilities,
  ...editorialCapabilities,
  ...settingsCapabilities,
  ...insightsCapabilities,
  ...schedulerCapabilities,
  ...connectionsCapabilities,
  ...installCapabilities,
];

export const registry = createRegistry(capabilities);

export * from "./connections";
export * from "./documents";
export * from "./editorial";
export * from "./insights";
export * from "./install";
export * from "./media";
export * from "./scheduler";
export * from "./settings";
export * from "./sites";
export * from "./render";
export * from "./shared";
export type { Database, StorageService } from "./services";
