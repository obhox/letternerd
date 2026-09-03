# Deploying to Coolify

One Coolify project, one Coolify-managed Postgres, one Docker Compose resource.
This mirrors how linkbry, everyos and patrio are already set up on this server.

## 1. Build and push images

Images build in GitHub Actions on pushes to `main` and are pushed to ghcr.io as:

```
ghcr.io/obhox/letternerd-studio:<tag>
ghcr.io/obhox/letternerd-db:<tag>
```

Both `latest` and the commit SHA are pushed. Never build on the server — a
build competing with the running app for RAM on a single-server host is how a
deploy takes the site down.

### The registry is private

`obhox/letternerd` is a private repository, so its packages are private too and
ghcr.io refuses anonymous pulls — a bare `docker pull` gets a 403, and in
Coolify that surfaces as a compose deploy that fails on `pull_policy: always`
before any container starts.

The server therefore needs credentials once:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u obhox --password-stdin
```

`GHCR_TOKEN` is a GitHub personal access token with **`read:packages`** and
nothing else — it only ever pulls. Coolify's own Docker daemon reads
`~/.docker/config.json`, so this is a one-time step per server rather than
anything the compose file knows about.

The alternative is making just the two packages public while the source stays
private, which GitHub allows per-package. That removes the login step, at the
cost of anyone being able to pull and inspect the built image. For a product
that is deliberately not open source, the token is the better trade.

## 2. Create the project and database

1. New Coolify project named `cms`.
2. Add a **PostgreSQL 17** database resource inside it. Turn on scheduled
   backups now, not later.
3. Copy its **internal** connection string — that becomes `DATABASE_URL`.

### Least-privilege database role

The connection string Coolify hands out is the database owner. Migrations need
that — they create tables and alter columns — but the studio does not, and a
container holding the owner role can drop the schema as easily as read it.
Give the app its own role with DML and nothing else, run as the owner:

```sql
CREATE ROLE cms_app LOGIN PASSWORD '<openssl rand -base64 32>';
GRANT CONNECT ON DATABASE cms TO cms_app;
GRANT USAGE ON SCHEMA public TO cms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cms_app;
-- Tables the next migration creates get the same grants. Default privileges
-- attach to the role that runs this statement, which is why it has to be the
-- owner that runs migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cms_app;
```

Migrations keep running as the owner. Both services read `DATABASE_URL` today,
so splitting them is one line in the compose file — a second variable for the
`studio` service — and is listed under follow-ups until that lands.

If the database is ever moved off the Docker network, append
`?sslmode=require` to the connection string. Inside the network the traffic
never leaves the host, which is the only reason it is tolerable without.

## 3. Add the compose resource

Point a Docker Compose resource at `infra/docker-compose.production.yml`.

Coolify generates the `SERVICE_*` variables itself:

| Variable | Meaning |
|---|---|
| `SERVICE_FQDN_STUDIO_3000` | wires Traefik to the studio container on :3000 |
| `SERVICE_FQDN_STUDIO` | the public origin, e.g. `https://cms.example.com` |
| `SERVICE_BASE64_64_AUTH` | generated `BETTER_AUTH_SECRET` |
| `SERVICE_PASSWORD_CRON` | generated `CRON_SECRET` |

Set the rest by hand: `DATABASE_URL`, `CMS_TRUSTED_ORIGINS`, the `S3_*` group,
`MEDIA_CDN_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `ANALYTICS_ENCRYPTION_KEY`
(`openssl rand -hex 32`). The last one is not needed for the studio to boot,
but it is needed before anyone creates a webhook or connects Search Console —
both store a secret under it and neither has a plaintext fallback — so set it
now rather than when the first error names it.

Three more have production defaults and only need setting to change them:
`CMS_ALLOW_SIGNUP` (`true`; set `false` to admit only invited addresses), `CMS_CLIENT_IP_HEADER` (`x-forwarded-for`; see
"Reverse-proxy headers") and `CMS_REQUIRE_2FA_ROLE` (`owner`; see "Two-factor
rollout"). `CMS_RATE_LIMIT` exists for end-to-end suites and should never be
set here.

### Email verification blocks the first boot

`@cms/auth` refuses to start when verification is required and no mail provider
is configured, and in production "required" is the default you get by saying
nothing. That is deliberate — failing open would let an unverified account claim
someone else's site invitation — but it means a deploy with no `RESEND_API_KEY`
does not start at all. Pick one before the first deploy:

- **Set `RESEND_API_KEY` and `EMAIL_FROM`.** The intended path. Verification
  works, invitations are safe.
- **Set `CMS_REQUIRE_EMAIL_VERIFICATION=false`.** Unblocks a first deploy where
  you are the only account and no invitations exist yet. It is a real weakening
  the moment you invite anyone, so treat it as temporary and remove it when mail
  is configured.

There is no third option where it boots and quietly skips verification.

## 4. Assign the domain

Set the studio's domain in Coolify. `SERVICE_FQDN_STUDIO_3000` does the Traefik
wiring; nothing else is needed.

Note this is the **CMS's own** hostname. It never appears in a canonical URL, a
sitemap or a feed — those are all built from each site's `baseUrl` and served on
that site's own domain.

### Reverse-proxy headers

The rate limiters key on the client address, which they read from the header
named by `CMS_CLIENT_IP_HEADER` — `x-forwarded-for` by default. That is only
trustworthy when the proxy in front *overwrites* the header with the real peer
rather than appending to whatever the client sent. Traefik overwrites it by
default; it only starts believing inbound values when
`forwardedHeaders.trustedIPs` or `forwardedHeaders.insecure` is set on the
entrypoint, so leave both alone unless another proxy sits in front of Traefik.

Behind Cloudflare, Traefik's peer is a Cloudflare edge, so every visitor would
share one budget and one visitor could exhaust it for everyone. Set
`CMS_CLIENT_IP_HEADER=cf-connecting-ip`. Cloudflare sets that header itself,
and it cannot be spoofed as long as the origin only accepts connections from
Cloudflare's address ranges — which is the firewall rule to add at the same
time.

Enable HSTS at Traefik as well. Whatever the studio sends, a redirect Traefik
issues before a request reaches the studio carries no header of the studio's,
so the first plain-HTTP request of a session is only covered if the proxy
covers it: a `headers` middleware with `stsSeconds` on the router, or the
equivalent switch in Coolify's proxy settings.

## 5. Object storage

Cloudflare R2 is the recommendation: no egress fees, a CDN in front of it, and
one less stateful container to back up on a single-server host. Create a bucket,
issue an S3 API token, put a CDN hostname in front, and set:

```
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=cms-media
MEDIA_CDN_URL=https://cdn.example.com
```

MinIO works identically — `@cms/media` derives `forcePathStyle` from the
presence of `S3_ENDPOINT`, so one client covers both.

## 6. Scheduled tasks

Add these as Coolify **Scheduled Tasks** on the `studio` service. There is no
worker container; the jobs are HTTP routes gated by `CRON_SECRET`.

| Schedule | Job |
|---|---|
| `* * * * *` | `publish-scheduled` |
| `17 3 * * *` | `crawler-rollup` |
| `23 3 * * *` | `link-suggestions` |
| `31 3 * * *` | `render-backfill` |
| `47 3 * * *` | `retention-gc` |

Each runs:

```
curl -fsSL --max-redirs 0 -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/<job>
```

`/api/cron` is on the proxy's public-prefix list, so it is never answered with
a redirect to the sign-in page. `-L --max-redirs 0` makes that a guarantee from
the caller's side too: a redirect budget of zero turns *any* redirect into a
curl error (exit 47) instead of a 307 that `-f` is happy with. Before the
prefix was added, every scheduled run was answered with exactly that 307,
reported as success, and scheduled publishing silently never ran.

## Two-factor rollout

With `CMS_REQUIRE_2FA_ROLE=owner` — the production default — an owner who has
not enrolled a TOTP authenticator is redirected to **Settings → Security** on
every studio navigation until they have. Nothing else is blocked: the content
API, MCP and cron carry their own credentials, and editors and authors are not
asked. Lower the threshold to `editor` or `author` once owners are enrolled;
`none` belongs only on a host where nobody can publish to a live site.

Tell owners *before* the deploy that carries the setting. The redirect is
abrupt for someone mid-edit, and an owner without their phone to hand is out of
the studio until they have it.

## Secret rotation runbook

Rotate on a schedule you can keep, and immediately on any suspicion. Each
secret has a different blast radius, which is why they are listed separately.

| Secret | How | What breaks, and for how long |
|---|---|---|
| `BETTER_AUTH_SECRET` | Replace the Coolify variable, redeploy. | Every session is invalidated — everyone signs in again — and any OAuth consent flow in flight fails at the callback, because its `state` was signed with the old key. Pick a quiet hour. |
| `CRON_SECRET` | Replace the variable, then update every Scheduled Task that presents it. | Jobs get 401 until the tasks are updated. `publish-scheduled` runs every minute, so the gap shows in its log at once. |
| `ANALYTICS_ENCRYPTION_KEY` | Re-encrypt *first*: `pnpm --filter @cms/studio reencrypt-secrets --old <key> --new <key>` against the production database, then replace the variable and redeploy. (The script is being added by the app team; do not rotate before it exists.) | Skipping the re-encrypt orphans every stored OAuth token and webhook secret: Search Console disconnects and every webhook fails its signature check at the receiver. |
| API keys | Revoke and re-issue per site from Settings → API keys; the new key is shown once. | The consuming site is down until its deployment carries the new key. Issue the new one, deploy the site, *then* revoke the old. |
| Google client secret | Rotate in Google Cloud Console, replace `GOOGLE_CLIENT_SECRET`, redeploy. | Existing refresh tokens keep working; only new connections use the new secret. Consent flows in flight fail. |

## Rollback

Set `CMS_IMAGE_TAG` to a previous commit SHA and redeploy. No rebuild.

Schema changes must stay backward-compatible for one release — add a column,
deploy, backfill, deploy the code that requires it, drop the old column in a
later release. Compose restarts the studio without draining, so the old and new
code overlap briefly.

## Follow-ups (not yet implemented)

Written down so nobody assumes they exist.

- **Webhook delivery.** Webhooks can be registered and their secrets are stored
  encrypted, but nothing delivers them yet. The deliverer needs egress checks
  before it ships — resolve the target, refuse private and link-local ranges,
  re-check after every redirect — or a webhook URL is an SSRF primitive
  against the Docker network.
- **Search Console provider.** The OAuth flow stores a token; no job reads the
  API with it yet.
- **Shared rate limiter.** Budgets are per process, so a second replica
  doubles every one of them. A Redis- or Postgres-backed store behind the
  existing interface, before the second replica.
- **Separate database roles.** The `cms_app` role above, and a second
  `DATABASE_URL` for the studio service.
- **`preview_tokens`.** The table exists and nothing writes to it. Wire preview
  links, or drop it in a migration.
