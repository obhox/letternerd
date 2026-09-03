import { eq, inArray } from "drizzle-orm";
import { createDb, closeDb } from "@cms/db";
import * as schema from "@cms/db/schema";
import { createStorage, type StorageConfig } from "@cms/media";

/**
 * Copy stored objects from one storage backend to another.
 *
 * Object keys are identical across backends and documents reference assets as
 * `media://<id>` rather than as URLs, so moving between MinIO, R2 and S3 is a
 * pure object copy — no database rows change and no content is rewritten. That
 * was the reason for opaque refs in the first place.
 *
 * Idempotent: an object already present at the destination is skipped, so this
 * can be re-run after a partial or interrupted copy.
 *
 *   pnpm --filter @cms/studio migrate-media -- --from-endpoint http://localhost:9100 \
 *     --from-bucket cms-media --from-key cmsminio --from-secret cmsminio123
 *
 * Destination is whatever the current environment points at.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const source: StorageConfig = {
    driver: "s3",
    endpoint: arg("from-endpoint") ?? "http://localhost:9100",
    region: arg("from-region") ?? "auto",
    bucket: arg("from-bucket") ?? "cms-media",
    accessKeyId: arg("from-key") ?? "cmsminio",
    secretAccessKey: arg("from-secret") ?? "cmsminio123",
  };

  const destination: StorageConfig = {
    driver: "s3",
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "auto",
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  };

  if (!destination.bucket || !destination.accessKeyId) {
    throw new Error("Destination is not configured; set the S3_* environment variables.");
  }

  const from = createStorage(source);
  const to = createStorage(destination);
  const db = createDb();

  const assets = await db.select().from(schema.mediaAssets);
  const variants = assets.length
    ? await db
        .select()
        .from(schema.mediaVariants)
        .where(inArray(schema.mediaVariants.assetId, assets.map((a) => a.id)))
    : [];

  const keys = [...assets.map((a) => a.key), ...variants.map((v) => v.key)];
  console.log(
    `[migrate-media] ${assets.length} assets, ${variants.length} variants — ${keys.length} objects`,
  );
  console.log(`[migrate-media] ${source.bucket} @ ${source.endpoint}`);
  console.log(`[migrate-media]   -> ${destination.bucket} @ ${destination.endpoint}\n`);

  const dryRun = process.argv.includes("--dry-run");
  let copied = 0;
  let skipped = 0;
  const failed: { key: string; reason: string }[] = [];

  for (const key of keys) {
    try {
      // Presence check first: re-running after an interruption should be cheap
      // and must not re-upload what already arrived.
      await to.get(key);
      skipped++;
      continue;
    } catch {
      // Absent at the destination, which is what we are here to fix.
    }

    if (dryRun) {
      console.log(`  would copy  ${key}`);
      copied++;
      continue;
    }

    try {
      const bytes = await from.get(key);
      const contentType = contentTypeFor(key);
      await to.put(key, bytes, contentType, "public, max-age=31536000, immutable");
      copied++;
      console.log(`  copied ${String(bytes.length).padStart(8)}  ${key.split("/").pop()}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ key, reason });
      console.error(`  FAILED ${key}: ${reason}`);
    }
  }

  console.log(
    `\n[migrate-media] ${copied} copied, ${skipped} already present, ${failed.length} failed`,
  );
  if (failed.length > 0) process.exitCode = 1;

  await closeDb();
}

/**
 * Derived from the key, not from the database.
 *
 * Variant rows carry a format, but the original's extension is the only record
 * of its type at rest, and a wrong Content-Type here is served to every browser
 * and crawler thereafter.
 */
function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    avif: "image/avif",
    webp: "image/webp",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}

main().catch(async (error) => {
  console.error("[migrate-media] failed:", error instanceof Error ? error.message : error);
  await closeDb().catch(() => {});
  process.exit(1);
});
