import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * The one shape every media consumer sees.
 *
 * Object storage is the only part of this package that differs between a
 * laptop, a CI box and production, so it is the only part behind an interface.
 * Everything above it — the processing pipeline, the key layout, the srcset
 * builders — is driver-agnostic and therefore testable against a plain
 * in-memory fake rather than a container.
 */
export interface StorageService {
  put(key: string, bytes: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(keys: string[]): Promise<void>;
  publicUrl(key: string): string;
  /**
   * Optional because only a real object store can hand a browser a URL it may
   * PUT to. The local driver has no equivalent, and callers that offer direct
   * browser uploads must feature-detect rather than assume.
   */
  presignPut?(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
}

export interface StorageConfig {
  driver: "s3" | "local";
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /**
   * Public origin the CDN serves objects from, e.g. `https://cdn.example.com`.
   *
   * Documents never store a URL. They store an opaque `media://<id>` ref, and
   * the URL is derived at render time from this one value. That is what makes
   * moving from R2 to a different CDN — or putting a new domain in front of the
   * same bucket — a single env var rather than a rewrite of every stored
   * document body.
   */
  cdnBaseUrl?: string;
  localRoot?: string;
}

/** Presign lifetime when the caller does not name one. Long enough for a slow upload, short enough to be worthless if leaked. */
const DEFAULT_PRESIGN_SECONDS = 900;

export function createStorage(config: StorageConfig): StorageService {
  return config.driver === "s3" ? createS3Storage(config) : createLocalStorage(config);
}

/**
 * One client for AWS S3, Cloudflare R2 and MinIO.
 *
 * `forcePathStyle` is the whole trick. Real AWS wants virtual-host addressing
 * (`https://bucket.s3.region.amazonaws.com/key`) and has been deprecating path
 * style for years. Anything reached through an explicit `endpoint` — MinIO in
 * docker-compose, R2's account endpoint — generally cannot do virtual-host
 * addressing at all, because there is no wildcard DNS in front of it. Keying
 * the choice off "did the operator configure an endpoint" gets both right
 * without a second config flag nobody would know how to set.
 *
 * Exported separately from the driver so the addressing decision can be
 * asserted in a test without standing up a bucket.
 */
export function createS3Client(config: StorageConfig): S3Client {
  const credentials =
    config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {};

  return new S3Client({
    region: config.region ?? "auto",
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: Boolean(config.endpoint),
    ...credentials,
  });
}

function createS3Storage(config: StorageConfig): StorageService {
  const bucket = config.bucket;
  if (!bucket) throw new Error("Storage driver 's3' requires a bucket.");

  const client = createS3Client(config);

  return {
    async put(key, bytes, contentType, cacheControl) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ...(cacheControl ? { CacheControl: cacheControl } : {}),
        }),
      );
    },

    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`Storage object ${key} has no body.`);
      return Buffer.from(await response.Body.transformToByteArray());
    },

    async delete(keys) {
      // DeleteObjects caps at 1000 keys per call, and deleting one asset's
      // variants can approach that once OG images are counted.
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        if (batch.length === 0) continue;
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },

    publicUrl(key) {
      return joinPublicUrl(config, bucket, key);
    },

    async presignPut(key, contentType, expiresInSeconds = DEFAULT_PRESIGN_SECONDS) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
}

/**
 * Filesystem driver for development.
 *
 * Not a production target: it has no CDN in front of it, no redundancy, and
 * `publicUrl` assumes the app serves `/media/*` itself. It exists so a
 * contributor can run the studio without credentials to anything.
 */
function createLocalStorage(config: StorageConfig): StorageService {
  const root = path.resolve(config.localRoot ?? ".media");

  return {
    async put(key, bytes) {
      const filePath = safeLocalPath(root, key);
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(filePath, bytes, { mode: 0o600 });
    },

    async get(key) {
      return readFile(safeLocalPath(root, key));
    },

    async delete(keys) {
      // `force` so deleting an asset twice is not an error — the caller is
      // usually reconciling a database row against storage, and a missing
      // object is the desired end state either way.
      await Promise.all(keys.map((key) => rm(safeLocalPath(root, key), { force: true })));
    },

    publicUrl(key) {
      return joinPublicUrl(config, undefined, key);
    },
  };
}

/**
 * Keys arrive from callers that may have taken them from user input, and a key
 * containing `..` or a leading `/` would otherwise resolve to somewhere outside
 * the media root — read `/etc/passwd`, write into the source tree. Resolving
 * first and then checking the prefix catches every encoding of that, which
 * string-inspecting the raw key does not.
 */
function safeLocalPath(root: string, key: string): string {
  const filePath = path.resolve(root, key);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return filePath;
}

function joinPublicUrl(config: StorageConfig, bucket: string | undefined, key: string): string {
  if (config.cdnBaseUrl) return `${trimSlash(config.cdnBaseUrl)}/${key}`;

  // No CDN configured. These fallbacks keep dev usable; production is expected
  // to always set `cdnBaseUrl`, because serving from the bucket origin means
  // the bucket's hostname ends up baked into cached HTML.
  if (config.driver === "local" || !bucket) return `/media/${key}`;
  if (config.endpoint) return `${trimSlash(config.endpoint)}/${bucket}/${key}`;
  return `https://${bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com/${key}`;
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
