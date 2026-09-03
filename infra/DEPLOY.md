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

### Make the packages public

A package inherits its repository's visibility, and this one was built while the
repository was private, so both packages are private today — an anonymous
manifest request returns 403. Coolify surfaces that as a compose deploy failing
on `pull_policy: always` before any container starts, which reads as a broken
deploy rather than a permissions setting.

Flip both to public once, in their GitHub package settings. Nothing in the
compose file or the workflow refers to visibility, so there is no code change
and no re-push; the tags already pushed simply become pullable.

Public is the right setting for an open-source platform: nothing in a published
image is a secret the source does not already give away, and every secret the
studio actually needs is injected at runtime from Coolify's env store, never
baked into a layer.

A fork that stays private keeps hitting the 403 above, and its fix is one
`docker login` per server with a token scoped to `read:packages` and nothing
else:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <owner> --password-stdin
```

Coolify's Docker daemon reads `~/.docker/config.json`, so that is a one-time
server step rather than anything the compose file knows about.

## 2. Create the project and database

1. New Coolify project named `letternerd-cms`.
2. Add a **PostgreSQL 17** database resource inside it. Turn on scheduled
   backups now, not later.
3. Copy its **internal** connection string — that becomes `DATABASE_URL`. The
   host is the database's own uuid, not `postgres` or `localhost`.

### Turn on "Connect to Predefined Network"

This one is not optional and it is not obvious. Coolify puts a Docker Compose
resource on a private network named after the application's uuid, while a
Coolify-*managed* database sits on the shared `coolify` network. Left alone the
studio cannot resolve the database host at all, and the failure looks like a
migration hanging rather than a networking problem.

The setting lives on the compose resource. With it on, the parser attaches the
destination's `coolify` network to every service in addition to the per-app one,
and the internal connection string resolves. The reverse proxy is unaffected
either way — it joins each app network itself, which is why routing works before
the database does.

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
