# Deploying to Coolify

One Coolify project, one Coolify-managed Postgres, one Docker Compose resource.
This mirrors how linkbry, everyos and patrio are already set up on this server.

## 1. Build and push images

Images build in GitHub Actions on pushes to `main` and are pushed to ghcr.io as:

```
ghcr.io/obhox/cms-studio:<tag>
ghcr.io/obhox/cms-db:<tag>
```

Both `latest` and the commit SHA are pushed. Never build on the server — a
build competing with the running app for RAM on a single-server host is how a
deploy takes the site down.

## 2. Create the project and database

1. New Coolify project named `cms`.
2. Add a **PostgreSQL 17** database resource inside it. Turn on scheduled
   backups now, not later.
3. Copy its **internal** connection string — that becomes `DATABASE_URL`.

## 3. Add the compose resource

Point a Docker Compose resource at `infra/docker-compose.production.yml`.

Coolify generates the `SERVICE_*` variables itself:

| Variable | Meaning |
|---|---|
| `SERVICE_FQDN_STUDIO_3000` | wires Traefik to the studio container on :3000 |
| `SERVICE_FQDN_STUDIO` | the public origin, e.g. `https://cms.example.com` |
| `SERVICE_BASE64_64_AUTH` | generated `BETTER_AUTH_SECRET` |
| `SERVICE_PASSWORD_CRON` | generated `CRON_SECRET` |
| `SERVICE_PASSWORD_WEBHOOK` | generated `WEBHOOK_SIGNING_KEY` |
| `SERVICE_PASSWORD_CRAWLERSALT` | generated `CRAWLER_IP_SALT` |

Set the rest by hand: `DATABASE_URL`, `CMS_TRUSTED_ORIGINS`, the `S3_*` group,
`MEDIA_CDN_URL`, `RESEND_API_KEY`, `EMAIL_FROM`.

`RESEND_API_KEY` is not optional in production. `@cms/auth` refuses to start
without a mail provider when email verification is required, which is
deliberate — the alternative is silently accepting unverified addresses, and an
unverified account can claim someone else's site invitation.

## 4. Assign the domain

Set the studio's domain in Coolify. `SERVICE_FQDN_STUDIO_3000` does the Traefik
wiring; nothing else is needed.

Note this is the **CMS's own** hostname. It never appears in a canonical URL, a
sitemap or a feed — those are all built from each site's `baseUrl` and served on
that site's own domain.

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
curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/<job>
```

## Rollback

Set `CMS_IMAGE_TAG` to a previous commit SHA and redeploy. No rebuild.

Schema changes must stay backward-compatible for one release — add a column,
deploy, backfill, deploy the code that requires it, drop the old column in a
later release. Compose restarts the studio without draining, so the old and new
code overlap briefly.
