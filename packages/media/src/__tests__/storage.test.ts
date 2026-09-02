import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  IMMUTABLE_CACHE_CONTROL,
  assetPrefix,
  createS3Client,
  createStorage,
  mediaRef,
  ogKey,
  originalKey,
  parseMediaRef,
  variantKey,
} from "../index.js";

const roots: string[] = [];

async function localRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cms-media-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("s3 addressing", () => {
  const creds = { accessKeyId: "key", secretAccessKey: "secret" };

  it("uses path style when an endpoint is configured", () => {
    const client = createS3Client({
      driver: "s3",
      endpoint: "http://127.0.0.1:9000",
      region: "auto",
      bucket: "media",
      ...creds,
    });

    expect(client.config.forcePathStyle).toBe(true);
  });

  it("uses virtual-host style against real AWS", () => {
    const client = createS3Client({
      driver: "s3",
      region: "eu-west-1",
      bucket: "media",
      ...creds,
    });

    expect(client.config.forcePathStyle).toBe(false);
  });

  it("offers presigned uploads", () => {
    const storage = createStorage({
      driver: "s3",
      endpoint: "http://127.0.0.1:9000",
      bucket: "media",
      ...creds,
    });

    expect(typeof storage.presignPut).toBe("function");
  });

  it("requires a bucket", () => {
    expect(() => createStorage({ driver: "s3", region: "eu-west-1" })).toThrow(/bucket/i);
  });
});

describe("public urls", () => {
  it("prepends the cdn base, so changing CDN is one env var", () => {
    const storage = createStorage({
      driver: "s3",
      bucket: "media",
      region: "eu-west-1",
      cdnBaseUrl: "https://cdn.example.com/",
    });

    expect(storage.publicUrl("sites/s1/media/a1/320.avif")).toBe(
      "https://cdn.example.com/sites/s1/media/a1/320.avif",
    );
  });

  it("falls back to the bucket origin without one", () => {
    const withEndpoint = createStorage({
      driver: "s3",
      bucket: "media",
      endpoint: "http://127.0.0.1:9000",
    });
    expect(withEndpoint.publicUrl("k")).toBe("http://127.0.0.1:9000/media/k");

    const awsHosted = createStorage({ driver: "s3", bucket: "media", region: "eu-west-1" });
    expect(awsHosted.publicUrl("k")).toBe("https://media.s3.eu-west-1.amazonaws.com/k");
  });
});

describe("local driver", () => {
  it("round-trips and deletes", async () => {
    const root = await localRoot();
    const storage = createStorage({ driver: "local", localRoot: root });

    await storage.put("sites/s1/media/a1/original.jpg", Buffer.from("bytes"), "image/jpeg");
    expect((await storage.get("sites/s1/media/a1/original.jpg")).toString()).toBe("bytes");
    expect(
      (await readFile(path.join(root, "sites/s1/media/a1/original.jpg"))).toString(),
    ).toBe("bytes");

    await storage.delete(["sites/s1/media/a1/original.jpg"]);
    await expect(storage.get("sites/s1/media/a1/original.jpg")).rejects.toThrow();

    // Deleting what is already gone is the desired end state, not an error.
    await expect(storage.delete(["sites/s1/media/a1/original.jpg"])).resolves.toBeUndefined();
  });

  it("rejects keys that escape the root", async () => {
    const root = await localRoot();
    const storage = createStorage({ driver: "local", localRoot: root });

    for (const key of [
      "../escaped.txt",
      "sites/../../escaped.txt",
      "a/b/../../../escaped.txt",
      "/etc/passwd",
    ]) {
      await expect(storage.put(key, Buffer.from("x"), "text/plain")).rejects.toThrow(
        /Invalid storage key/,
      );
      await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
    }
  });

  it("has no presign", async () => {
    const storage = createStorage({ driver: "local", localRoot: await localRoot() });
    expect(storage.presignPut).toBeUndefined();
  });
});

describe("key layout", () => {
  it("is derived only from immutable ids", () => {
    expect(assetPrefix("s1", "a1")).toBe("sites/s1/media/a1");
    expect(originalKey("s1", "a1", "jpg")).toBe("sites/s1/media/a1/original.jpg");
    expect(originalKey("s1", "a1", ".jpg")).toBe("sites/s1/media/a1/original.jpg");
    expect(variantKey("s1", "a1", 640, "avif")).toBe("sites/s1/media/a1/640.avif");
    expect(ogKey("s1", "doc1", "deadbeef")).toBe("sites/s1/og/doc1-deadbeef.png");
    expect(IMMUTABLE_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
  });

  it("refuses ids that would retarget the key into another tenant", () => {
    expect(() => assetPrefix("s1/../s2", "a1")).toThrow(/Invalid key segment/);
    expect(() => originalKey("s1", "..", "jpg")).toThrow(/Invalid key segment/);
    expect(() => variantKey("s1", "a1", 0, "avif")).toThrow(/Invalid variant width/);
  });

  it("round-trips opaque media refs", () => {
    expect(mediaRef("a1")).toBe("media://a1");
    expect(parseMediaRef("media://a1")).toBe("a1");
    expect(parseMediaRef("https://cdn.example.com/a1.jpg")).toBeNull();
    expect(parseMediaRef("media://")).toBeNull();
  });
});
