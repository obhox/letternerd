# cms

An MCP-first, multi-site CMS for blog and website content, built for SEO, AEO and GEO.

It is **headless**: the CMS stores, renders and serves content, and a typed SDK
server-renders it inside each consuming site's own Next.js app. Canonical URLs,
`sitemap.xml`, `robots.txt` and `llms.txt` all live on the *consuming* domain —
the CMS never serves a canonical artifact.

It is **MCP-first**: `packages/core` is the single capability layer. Every domain
operation is one typed function with a Zod schema and its own authorization
check. The MCP server, the REST API and the studio's server actions are three
thin transports over that one implementation, so no surface can drift behind
another.

## Layout

```
apps/studio      Next 16 — admin UI + REST API + remote MCP endpoint
apps/mcp-stdio   stdio MCP binary for `claude mcp add`
apps/cli         `cms import ./content/posts --site <slug>`

packages/core    capability layer, roles, scopes, errors  (depends on nothing)
packages/db      Drizzle schema, migrations, API keys
packages/auth    better-auth factory, site-scoped authorization
packages/content markdown pipeline, stable anchors, editorial lints
packages/seo     JSON-LD, sitemap/robots/feed/llms builders, validators
packages/media   sharp variants, blurhash, S3-compatible storage
packages/sdk     @obhox/cms-sdk — the published client
packages/ui      shadcn/ui + Tailwind v4 preset
```

## Local development

```bash
cp .env.example .env      # then replace the dev secrets
pnpm install
pnpm infra:up             # postgres on :5434, MinIO on :9100 (console :9101)
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm infra:down` stops the stack; data persists in `infra/.data/`.

## Checks

```bash
pnpm -r typecheck
pnpm -r test
```

## Deployment

Coolify, one project with a Coolify-managed Postgres resource. Images build in
GitHub Actions and are pulled by tag — see `infra/DEPLOY.md`.
