/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The workspace packages ship as TypeScript source rather than build output,
  // so Next compiles them itself. This is why the Docker build needs the whole
  // tree rather than a pruned copy.
  transpilePackages: [
    "@cms/core",
    "@cms/db",
    "@cms/auth",
    "@cms/content",
    "@cms/seo",
    "@cms/media",
    "@cms/ui",
  ],

  // Native or CJS-heavy packages that must not be bundled into the server
  // build. sharp in particular has to resolve its platform binary at runtime.
  serverExternalPackages: ["sharp", "postgres", "pg", "better-auth", "shiki"],

  /**
   * Upload bodies must clear the base64 ceiling, not the image one.
   *
   * MEDIA_MAX_UPLOAD_BYTES is 25 MB of image, but the transport is base64 —
   * four characters per three bytes — so the request body is about 33 MB.
   * Next's 10 MB default silently TRUNCATES rather than rejecting, which means
   * an 8 MB photo arrives as a corrupt half-file and fails somewhere much less
   * obvious than the upload. 36 MB leaves headroom for the JSON envelope.
   *
   * The limits are deliberately stated in one place; raising the image limit
   * without raising these reintroduces the same silent truncation.
   */
  experimental: {
    serverActions: { bodySizeLimit: "36mb" },
    // Next names this under experimental; middlewareClientMaxBodySize is the
    // deprecated spelling of the same setting.
    proxyClientMaxBodySize: "36mb",
  },

  // Nothing here is ever indexed: the studio is an admin surface, and the
  // content it manages is canonical on other people's domains.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
