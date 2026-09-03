# Security policy

## Reporting a vulnerability

Email **info@cryptoconsultz.com**. Say which path or package is affected,
which commit you tested against, and how to reproduce it; a working proof of
concept is worth more than a scanner report. You will get an acknowledgement
within three working days and a fix timeline once the report is confirmed.

Do not open a public issue for anything that looks exploitable.

## Scope

In scope is everything in this repository: the studio (`apps/studio`) and its
REST, MCP and cron endpoints, the published SDK (`packages/sdk`), the
workspace packages, and the deployment files under `infra/`. The reports that
matter most are against the tenant boundary
(`packages/auth/src/site-scope.ts`), API-key handling
(`packages/db/src/api-keys.ts`), the OAuth state signing
(`apps/studio/src/app/api/oauth/google/state.ts`) and the markdown sanitiser
(`packages/content/src/sanitize-schema.ts`). `docs/THREAT_MODEL.md` explains
why those four.

Out of scope: denial of service by sheer volume, anything that needs a
compromised operator account or host to begin with, findings against the
services this deploys onto (Coolify, Cloudflare, Google), and anything
reproducible only with `CMS_RATE_LIMIT=off` or another explicitly unsafe
development setting.

## Disclosure

Coordinated, on a 90-day clock. A confirmed issue is fixed and shipped within
90 days of the report; publish after that, or after the fix ships, whichever
comes first. If a fix genuinely needs longer you will be told why and given a
date, and asked — not required — to hold.

There is no bug bounty. Credit in the release notes is offered to anyone who
wants it.

## Supported versions

`main` only. Production deploys pull the image built from the latest push to
`main`; there are no maintained release branches, so there is nothing older to
backport a fix to.
