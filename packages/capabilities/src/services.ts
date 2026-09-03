import type { NetService } from "@cms/core";
import type { Database } from "@cms/db";
import type { StorageService } from "@cms/media";

/**
 * What a capability handler is allowed to reach for.
 *
 * Declared by augmenting the interface `@cms/core` exports rather than by
 * having core import this package. Core sits at the root of the dependency
 * graph with no dependencies of its own — it is imported by `@cms/db`, so a
 * dependency back on the database would be a cycle. Declaration merging gives
 * handlers full types without one.
 *
 * Everything here is injected. No capability reads an environment variable or
 * constructs its own database connection, which is what makes the whole layer
 * testable against fakes and what lets one process serve MCP, REST and the
 * studio from a single set of services.
 */
declare module "@cms/core" {
  interface CapabilityServices {
    db: Database;
    storage: StorageService;
    /** Injected so tests can freeze it; publishing and scheduling both care. */
    now: () => Date;
    /**
     * Deployment-specific ceilings. Optional because every transport that
     * omits them gets the compiled-in defaults, which are the hard maximums —
     * configuration can only lower a limit, never raise it past what the
     * schema was written to bound.
     */
    limits?: ServiceLimits;
    /**
     * DNS, for the outbound-URL checks. Optional so a test can run without a
     * network and a transport that has none skips the resolved check; the
     * syntactic half always runs.
     */
    net?: NetService;
  }
}

export interface ServiceLimits {
  /** Decoded bytes a single upload may carry. Capped by `MAX_UPLOAD_BYTES`. */
  maxUploadBytes?: number;
}

export type { Database, StorageService };
