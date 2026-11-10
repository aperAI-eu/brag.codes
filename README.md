# brag.codes

Share what you built. Discover projects from people and events.

Source for the [brag.codes](https://brag.codes) application, built with Next.js,
React, TypeScript and PostgreSQL. Includes typed, voice and agent-assisted project
capture, optional event linking, publication, a public gallery, moderation and
Google/GitHub sign-in. The shared UI and fictional interactive catalogue use the
Sage & Copper visual identity.

## Run locally

Requires Node.js 24, npm, Python 3 and Docker Engine with Compose on Linux.

```bash
npm ci
npm run db:generate
npm run app:setup
npm run db:up
npm run db:migrate
npm run credentials:setup
npm run app:dev
```

Open http://127.0.0.1:3200. Setup generates fresh local database/session credentials
under ignored `.localfiles/runtime-dev/`; never commit this directory. The application
uses separate runtime, migration and administrator database roles. `db:down` stops
containers without deleting the database volume.

Sign-in requires your own OAuth application. Store its client ID and secret in
`.localfiles/runtime-dev/identity/github-client-id` and `github-client-secret`, or
`google-client-id` and `google-client-secret` (restrict local file access). Register
`http://127.0.0.1:3200/api/auth/callback/github` or `/google` as the callback, then
restart the app. Unconfigured providers stay disabled. No hosted credentials or
production data are included.

Platform administration is an explicit operator action; nobody automatically becomes
an admin. The protected [role tool](app/scripts/admin-role.ts) supports `inspect ACCOUNT_ID`
and `apply REQUEST_FILE` with an operator database credential. Review its
[identity and version checks](app/src/lib/administration/roles.ts) before assignment. AI processing needs separately configured provider credentials through
**Admin → API setup**. Typed capture and fictional catalogue examples do not require
AI provider credentials. Voice processing uses external services and may incur costs.

## UI catalogue

```bash
npm run ui:dev
```

Open http://127.0.0.1:3100. Catalogue scenarios use fictional data and simulated
outcomes; they do not exercise real sign-in or provider services. Production consumes
the shared views from `app/src/ui`; catalogue fixtures remain separate.

## Checks

```bash
npm run app:test
npm run app:build
npm run app:typecheck
npm run ui:build
npm run ui:typecheck
npx playwright install --with-deps chromium
npm run ui:test
npm run app:test:integration
```

Integration tests create and delete their own isolated Docker databases and synthetic
identities, with provider transport mocked. They do not use your development database.
Use Linux with Docker host networking for the transport checks. The optional
`sharing-cutover` suite additionally needs a compatible previous-schema image and is
not part of the default suite. Test artifacts stay under ignored `.localfiles/`.

Build a standalone app or migration image using `deploy/runtime/Dockerfile` targets
`runtime` and `migration`. The Compose file is a loopback-only development setup;
proxy files and recovery SQL in this snapshot support tests. Hosting configuration,
TLS, backup operations and live monitoring must be provided for your own environment.
The included legal pages describe the hosted brag.codes service; adapt them before
operating an independent service.

## Source and licence

This repository contains reviewed source snapshots with independent history. It
contains no hosted accounts, credentials, operational data or private delivery records.
Public CI runs on hosted runners and has no deployment access.

Original code: [MIT](LICENSE). Bundled Space Grotesk remains under its
[Open Font License](app/src/ui/assets/spacegrotesk-OFL.txt). Dependency licences remain
with their respective authors; package identities and integrity are in the lockfile.

[Powered by aperAI](https://aperai.eu/).
