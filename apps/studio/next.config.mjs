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

  experimental: {
    // Uploads are multipart and can reach the media size limit.
    serverActions: { bodySizeLimit: "26mb" },
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
