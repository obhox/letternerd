---
name: letternerd-install
description: Install the Letternerd CMS SDK into a customer's Next.js App Router site — the client, the post page, sitemap/robots/rss/llms.txt routes, the markdown alternate and the revalidation webhook. Use when someone asks to connect, wire up, integrate or install Letternerd, @letternerd/sdk, or a Letternerd blog into an existing site, or when a repository already has @letternerd/sdk and the integration is incomplete or broken.
---

# Installing @letternerd/sdk

You are in the customer's repository. The CMS is the authority on what to
write; do not invent the SDK's API from memory.

## 1. Get the plan

In this order. Stop at the first that works.

1. **MCP connected to the studio** → call `get_install_plan`.
   Pass `packageManager` if the repo's lockfile says something other than pnpm.
   It returns `files` (path + exact contents), `env`, `install`, `nextConfig`,
   `verify` and `notes`. This is the only source that knows the site's real
   API URL, blog base path, locale and a published slug.
2. **No MCP, but a studio URL and a read key** →
   `npx @letternerd/sdk init --dry-run --studio-url <url> --key <cms_sk_…>`,
   then re-run without `--dry-run`.
3. **Neither** → `npx @letternerd/sdk init --dry-run --blog-path <path> --site-url <origin>`.
   This writes correct files with placeholder values. Say so.

## 2. Read before you write

- Read every path in `files` first. **Never overwrite a file that exists** —
  every entry is `overwrite: false`. Write only what is missing.
- Report each skip by name. Do not merge, do not "improve", do not reformat.
- If the project keeps its app router at `src/app`, move `app/…` and `lib/…`
  paths under `src/`. `next.config.*` stays at the repository root.
- `next.config.*` is a **merge**, never a replacement: add the one rewrite from
  `nextConfig.rewrite` to the array `rewrites()` returns. Leave the rest alone.

## 3. Never invent a key

`CMS_API_KEY` is not in the plan and cannot be. Do not generate one, do not
guess one, do not call `create_api_key` on your own initiative — it is
owner-only and minting a credential is a person's decision.

Write `.env.local` yourself only if the user asks. Otherwise print the block
from `env.snippet` and tell them the key must come from a site owner
(Install → Get a key in the studio, shown exactly once).

## 4. Install and verify

1. Run `install.command` (e.g. `pnpm add @letternerd/sdk@next`).
2. Build. An unresolved import means the plan and the installed version
   disagree — say so rather than editing the imports.
3. Run every check in `verify` against the customer's own domain, not the
   studio's. Each carries `expect` and `failure`; when one fails, quote its
   `failure` text — it names the file to open.

## Report at the end

- Files written, files skipped, each by path.
- The env values and the key the user must supply.
- The `next.config` merge, if their config already existed.
- Every entry in `notes` — including that outbound webhook delivery is not
  implemented in this build, so publishing does not yet purge their cache;
  content refreshes on the `revalidate` window in `lib/cms.ts` instead.

## Do not

- Do not re-sanitise what `<PostBody>` renders. It is sanitised at publish time;
  a second pass strips the `cms-*` classes and heading ids, so the page ships
  unstyled with dead anchors and still passes review.
- Do not put the key in a `NEXT_PUBLIC_*` variable. A `cms_sk_` key sent from a
  browser is refused with a 403.
- Do not serve the sitemap, robots.txt, rss.xml or llms.txt from the studio.
  They must come from the customer's own origin or crawlers discard them.
- Do not attempt this on a Pages Router project. There is no variant of these
  route handlers for it.
