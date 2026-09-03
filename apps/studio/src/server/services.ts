import { lookup } from "node:dns/promises";
import { createDb, type Database } from "@cms/db";
import type { ServiceLimits } from "@cms/capabilities";
import type { NetService } from "@cms/core";
import { createStorage, type StorageService } from "@cms/media";
import { env } from "@/env";

/**
 * The service container capabilities run against, built once per process.
 *
 * Capabilities take everything they need as an argument and read no
 * environment themselves, which is what lets the same code serve the studio,
 * the REST API and the MCP server. This module is the one place those
 * dependencies are actually constructed.
 */

declare global {
  // eslint-disable-next-line no-var
  var __cmsServices: { db: Database; storage: StorageService; limits: ServiceLimits; net: NetService } | undefined;
}

function build() {
  return {
    db: createDb(env.DATABASE_URL),
    storage: createStorage({
      driver: env.MEDIA_STORAGE_DRIVER,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      cdnBaseUrl: env.MEDIA_CDN_URL,
    }),
    limits: { maxUploadBytes: env.MEDIA_MAX_UPLOAD_BYTES },
    net: {
      // Every answer, both families: a name with one public and one private
      // address is refused by the caller, and only a full answer reveals that.
      resolve: async (hostname: string) => (await lookup(hostname, { all: true })).map((a) => a.address),
    },
  };
}

// Next's dev server re-evaluates modules on every edit. Without this a hot
// reload opens a new pool each time until Postgres refuses connections.
const services = globalThis.__cmsServices ?? build();
if (process.env.NODE_ENV !== "production") globalThis.__cmsServices = services;

export const db = services.db;
export const storage = services.storage;
export const limits = services.limits;
export const net = services.net;
export const now = () => new Date();
