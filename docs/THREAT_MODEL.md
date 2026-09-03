# Threat model

What this system protects, from whom, and which pieces of code do the
protecting — written so that a change touching one of the named files can be
judged against the boundary it defends. Deliberately short: a threat model
nobody reads protects nothing.

## What is being protected

| Asset | Where it lives | Why it matters |
|---|---|---|
| Tenant content and drafts | Postgres, `site_id` on every table | The product. A cross-tenant read leaks unpublished material; a cross-tenant write publishes it on somebody else's domain. |
| API keys | Postgres, as a SHA-256 digest only | An admin key publishes to a live site; a read key exposes drafts. The plaintext is shown once and never stored. |
| Studio sessions | Signed cookies under `BETTER_AUTH_SECRET` | A forged or stolen owner session mints keys and publishes. |
| Google OAuth refresh tokens | Postgres, encrypted with `ANALYTICS_ENCRYPTION_KEY` | Indefinite read access to a customer's Search Console. |
| Webhook signing secrets | Postgres, under the same cipher | Forged deliveries to the customer's receiver, which trusts the signature. |
| Media objects | S3-compatible bucket, world-readable | Defacement and egress cost rather than confidentiality: the bucket is public by design. |
| Operator secrets | Coolify's environment | Every asset above at once. |

## Who it is being protected from

| Actor | Holds | Wants |
|---|---|---|
| Anonymous | Nothing | Account spam, credential stuffing, an exhausted database pool, another tenant's drafts through a guessable id or invitation token. |
| Author | A session and the `author` role on one site | To publish without an editor, or to edit a document that is not theirs. |
| Editor | The `editor` role | To reach settings, keys or members, which are owner-only. |
| Owner | The `owner` role on their sites | Nothing against their own site; everything against every other tenant on the host. |
| Publishable-key holder (`cms_pk_…`) | A key lifted from a consuming site's browser bundle | To stuff analytics, or to read anything beyond published content. The key is assumed public. |
| Read-key holder (`cms_sk_…`) | A key from a consuming site's server | To read drafts on a second site, or to write to the first. |
| Admin-key holder (`cms_ak_…`) | Everything for one site | To reach a second site. |
| MCP agent | A key, driven by a model that reads content it did not write | To be talked into a destructive capability by text inside a document. |
| Platform operator | The host, the database, every variable | Trusted. The model does not defend against the operator; it defends the operator's tenants from everyone else. |

## Trust boundaries

Each boundary names what crosses it and the check that runs when it does.
Every one of them ends at the same place — `requireSite` — because the whole
tenant boundary reduces to where `actor.siteId` came from.

| Boundary | What crosses | Authenticated by | Authorised by |
|---|---|---|---|
| Browser → studio | Session cookie, form posts, server actions | better-auth, with the database, in the request handler — never in the proxy | `requireSite` (`packages/auth/src/site-scope.ts`) resolves the one site the actor may touch; each capability then asserts a role |
| SDK → `/api/v1` | Bearer API key | `packages/db/src/api-keys.ts`: constant-time comparison of a SHA-256 digest; the key carries a type, scopes and an expiry | Same `requireSite`, with the site fixed at issuance; scopes checked per capability |
| MCP client → `/api/mcp` | Bearer API key, tool calls | As `/api/v1` | The tool list *is* the capability registry, so no tool exists that the REST layer would refuse |
| Scheduler → `/api/cron` | `CRON_SECRET` as a bearer token | Compared against a secret that must be strong in production (`apps/studio/src/env.ts`); a weak one is treated as absent and the endpoint refuses everything | Jobs run as a system actor across sites; the endpoint is the only place that actor is built |
| Studio → Postgres | Every query | `DATABASE_URL` | Every table carries `site_id` and every query filters on `actor.siteId`; the tenant-isolation tests in `packages/db` exist to catch a missing filter |
| Studio → object storage | Uploads and variants | The `S3_*` credentials | Uploads go through the media capability as a site-scoped actor; reads are public by design |
| Studio ↔ Google | OAuth consent and token exchange | An HMAC-signed, nonce-bound, user-bound `state` (`apps/studio/src/app/api/oauth/google/state.ts`) | Only an owner may open the consent screen, and only for their own site |

## The controls, by file

| Control | File | What it prevents |
|---|---|---|
| Capability registry | `packages/core/src/capability.ts` | A transport with its own, weaker permission check. Every operation declares its role and scope once; MCP, REST and the studio's server actions dispatch into the same table, and a parity test fails the build when one stops covering an entry. |
| Single site resolution | `packages/auth/src/site-scope.ts` | Cross-tenant access. The only code that turns a request into a `siteId`. No capability input carries one and no handler assembles its own filter, so there is exactly one place to get it wrong. |
| API-key storage and verification | `packages/db/src/api-keys.ts` | Usable credentials in a database dump (digest only), a timing oracle on the comparison (`timingSafeEqual`), use after revocation or expiry. |
| OAuth state | `apps/studio/src/app/api/oauth/google/state.ts` | Cross-site consent — an attacker's Google account attached to a victim's site. Signature, single-use nonce cookie, session-bound user id: three checks, none of which replaces another. |
| Markdown sanitiser | `packages/content/src/sanitize-schema.ts` | Stored XSS through an author's markdown or an imported document. GitHub's allow-list, widened only by name and only where the pipeline needs it. |
| Proxy | `apps/studio/src/proxy.ts` | Unauthenticated browsing of the studio UI, and responses without security headers. Redirects on the *presence* of a session cookie only — every real check runs behind it with the database — and issues a per-request CSP nonce. |
| Request budgets | `apps/studio/src/server/rate-limit.ts` | Pool exhaustion by garbage bearer tokens, CPU pinning by concurrent uploads, analytics stuffing from a public key, credential and invitation-token guessing. Fixed windows per process, keyed on the address in `CMS_CLIENT_IP_HEADER`. |
| Environment validation | `apps/studio/src/env.ts` | A placeholder secret reaching production, sign-up open by accident, a weak `CRON_SECRET` accepted. |
| Container hardening | `infra/docker-compose.production.yml` | Persistence or escalation after code execution in the container: read-only root, every capability dropped, no new privileges, a memory ceiling. |
| Supply chain | `.npmrc`, `.github/` | A malicious patch release (seven-day cooldown), a moved action tag (commit pins), a vulnerable base image (Trivy on every push to `main`), a credential in history (gitleaks over the full clone). |

## Residual risks

Known, accepted for now, and the reason each one is not fixed yet.

| Risk | Why it is accepted | What would close it |
|---|---|---|
| Request budgets are per process | One replica today. The store sits behind a single-function interface so a shared one is a drop-in. | A Redis- or Postgres-backed store the day a second replica exists. |
| Publishable keys are public | By design: they ship in browser bundles. They can only write analytics beacons, and that budget is the tightest of all. | Nothing; watch `analytics-write` refusals. |
| Prompt injection through content into an MCP agent | The agent holds only its key's role, so content cannot escalate it; a destructive tool needs the same role a person would. | Confirmation on destructive tools, and issuing `read` keys to agents that only read. |
| Webhook delivery is not implemented | Nothing egresses yet, so there is no SSRF surface — but the first implementation creates one. | Egress checks in the deliverer before it ships: resolve the target, refuse private and link-local ranges, re-check after redirects. |
| The media bucket is world-readable | Required: browsers and crawlers fetch media directly. | Signed URLs for unpublished media, if drafts ever carry images that matter. |
| The studio and the migrator share one database role | One `DATABASE_URL` today. | The `cms_app` role in `infra/DEPLOY.md` and a second variable for the studio. |
| The `preview_tokens` table exists and nothing writes to it | Dead schema, not a hole — but an unused token table invites someone to use it without reading it first. | Wire preview links, or drop the table in a migration. |
| The operator is fully trusted | Single-operator deployment. | Not a goal. |

## Assumptions the controls depend on

Each control above is only as good as one or two things outside the code. If
one of these stops being true, the corresponding row in the controls table is
weaker than it reads.

| Assumption | Depended on by | If it fails |
|---|---|---|
| Traefik overwrites `X-Forwarded-For` with the real peer (or `CMS_CLIENT_IP_HEADER` names a header the proxy sets itself) | Request budgets | A client picks its own address per request and the budgets meter nothing. `infra/DEPLOY.md`, "Reverse-proxy headers". |
| `BETTER_AUTH_SECRET`, `CRON_SECRET` and `ANALYTICS_ENCRYPTION_KEY` are strong and not the example values | Sessions, cron, OAuth state, every stored secret | `env.ts` refuses to boot in production on a weak or placeholder value, so this fails loudly — unless `NODE_ENV` is not `production`, in which case nothing checks. |
| Only `main` builds images, and only CI pushes them | Supply chain | An image built on a laptop carries whatever that laptop's `node_modules` held. The compose files pull by tag and never build. |
| The database is reached over the Docker network, or over TLS | Studio → Postgres | Plaintext credentials on a shared network. `sslmode=require` the moment the database moves off the host. |
| The container runs as `cms` with a read-only root | Container hardening | The compose file sets it; a `docker run` by hand does not. |
| Consuming sites keep `cms_sk_` and `cms_ak_` keys server-side | API keys | A read key in a browser bundle is a draft leak; an admin key there is a takeover. The SDK's transport guard (`packages/sdk/src/transport-guard.ts`) refuses to send a key over plaintext HTTP to anything but loopback, but nothing can stop a site bundling one for the browser. |

## When a change touches one of these files

The question to ask before merging, per file. CODEOWNERS routes each of these
paths to review for this reason.

- `packages/core/src/capability.ts` — does every capability still declare a
  role and a scope, and does `assertRegistryParity` still cover every
  transport? A capability reachable from one transport and not another is the
  drift this file exists to prevent.
- `packages/auth/src/site-scope.ts` — is this still the only place a request
  becomes a `siteId`? Search for a second one before approving; a handler that
  builds its own filter has moved the tenant boundary without saying so.
- `packages/db/src/api-keys.ts` — is the plaintext still never stored, is the
  comparison still constant-time, and do revocation and expiry still short-
  circuit before any query runs as the key's actor?
- `apps/studio/src/app/api/oauth/google/state.ts` — are all three checks still
  there, in that order, and is the signature still verified before any field
  of the payload is read?
- `packages/content/src/sanitize-schema.ts` — is each addition to the schema
  named individually, and is there a test with the payload it would otherwise
  let through? Never widen a wildcard.
- `apps/studio/src/proxy.ts` — does the redirect still decide on cookie
  *presence* only, and does every route added to `PUBLIC_PREFIXES` perform its
  own authentication? A public prefix without one is an open route.
- `apps/studio/src/server/rate-limit.ts` — is every new entry point in
  `RULES`, and is the bad-credential budget still applied before the database
  is consulted?
- `apps/studio/src/env.ts` — is a new secret wrapped in `strongSecret`, and
  does an unset value fall to the *safer* default in production?
- `infra/**`, `.github/**` — did a pin move without a reason in the commit,
  did a job gain a permission, did a port leave loopback?
