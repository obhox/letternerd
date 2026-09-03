import { eq, isNotNull } from "drizzle-orm";
import { createDb, closeDb } from "@cms/db";
import * as schema from "@cms/db/schema";
import { WEBHOOK_SECRET_PREFIX, createTokenCipher } from "@cms/capabilities";

/**
 * Rotate `ANALYTICS_ENCRYPTION_KEY`, or seal secrets that predate encryption.
 *
 * Everything the studio stores and must later *replay* — Google refresh and
 * access tokens, webhook signing secrets — is AES-256-GCM ciphertext under
 * one key. Rotating that key means decrypting every row with the old one and
 * re-encrypting with the new one, in a transaction, before the running studio
 * is given the new value. Run this first, then update the environment, then
 * redeploy; in that order a request served during the window still decrypts.
 *
 *   pnpm --filter @cms/studio reencrypt-secrets -- --old <key> --new <key>
 *   pnpm --filter @cms/studio reencrypt-secrets -- --seal-legacy
 *
 * `--seal-legacy` takes the current key from the environment and encrypts
 * webhook secrets written before secrets were sealed (rows without the
 * `enc1:` marker). It is idempotent: sealed rows are left alone.
 *
 * Runs against production by design. It reads nothing but the two keys and
 * prints counts, never values.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const sealLegacy = process.argv.includes("--seal-legacy");
  const oldKey = flag("--old");
  const newKey = flag("--new") ?? (sealLegacy ? process.env.ANALYTICS_ENCRYPTION_KEY : undefined);

  if (!newKey || (!sealLegacy && !oldKey)) {
    console.error("Usage: reencrypt-secrets --old <key> --new <key>   |   reencrypt-secrets --seal-legacy");
    process.exit(2);
  }

  const next = createTokenCipher(newKey);
  const previous = oldKey ? createTokenCipher(oldKey) : null;
  const db = createDb();

  const report = { webhooksSealed: 0, webhooksRotated: 0, connectionsRotated: 0 };

  await db.transaction(async (tx) => {
    const hooks = await tx
      .select({ id: schema.webhooks.id, secret: schema.webhooks.secret })
      .from(schema.webhooks);

    for (const hook of hooks) {
      const sealed = hook.secret.startsWith(WEBHOOK_SECRET_PREFIX);
      let plaintext: string;
      if (!sealed) {
        plaintext = hook.secret;
        report.webhooksSealed += 1;
      } else if (previous) {
        plaintext = previous.decrypt(hook.secret.slice(WEBHOOK_SECRET_PREFIX.length));
        report.webhooksRotated += 1;
      } else {
        continue;
      }
      await tx
        .update(schema.webhooks)
        .set({ secret: `${WEBHOOK_SECRET_PREFIX}${next.encrypt(plaintext)}` })
        .where(eq(schema.webhooks.id, hook.id));
    }

    if (previous) {
      const connections = await tx
        .select({
          id: schema.siteAnalyticsConnections.id,
          accessTokenEncrypted: schema.siteAnalyticsConnections.accessTokenEncrypted,
          refreshTokenEncrypted: schema.siteAnalyticsConnections.refreshTokenEncrypted,
        })
        .from(schema.siteAnalyticsConnections)
        .where(isNotNull(schema.siteAnalyticsConnections.refreshTokenEncrypted));

      for (const row of connections) {
        await tx
          .update(schema.siteAnalyticsConnections)
          .set({
            accessTokenEncrypted: row.accessTokenEncrypted
              ? next.encrypt(previous.decrypt(row.accessTokenEncrypted))
              : row.accessTokenEncrypted,
            refreshTokenEncrypted: row.refreshTokenEncrypted
              ? next.encrypt(previous.decrypt(row.refreshTokenEncrypted))
              : row.refreshTokenEncrypted,
          })
          .where(eq(schema.siteAnalyticsConnections.id, row.id));
        report.connectionsRotated += 1;
      }
    }
  });

  console.log(`[reencrypt-secrets] done: ${JSON.stringify(report)}`);
  if (previous) {
    console.log("[reencrypt-secrets] now set ANALYTICS_ENCRYPTION_KEY to the new value and redeploy.");
  }
  await closeDb();
}

main().catch(async (error) => {
  console.error("[reencrypt-secrets] failed; nothing was changed:", error instanceof Error ? error.message : error);
  await closeDb().catch(() => {});
  process.exit(1);
});
