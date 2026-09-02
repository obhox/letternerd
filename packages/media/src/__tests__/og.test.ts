import { describe, expect, it } from "vitest";

import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, generateOgImage } from "../index.js";

describe("generateOgImage", () => {
  it("is a fixed interface with no implementation yet", async () => {
    await expect(
      generateOgImage({ template: "article", title: "Hello" }),
    ).rejects.toThrow("not implemented");
  });

  it("targets the size every crawler crops to", () => {
    expect([OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT]).toEqual([1200, 630]);
  });
});
