# Grant Mail Tracker

A private author-outreach workspace for **Grant Publishing Co.** Built with Next.js, TypeScript, Tailwind, Prisma/SQLite, Nodemailer, ImapFlow and a Cloudflare Worker/D1 companion.

All dashboard numbers come from the database. There are no seeded prospects or invented activity. Campaigns organize one-to-one messages; neither campaigns nor follow-ups send automatically.

## Run locally

Install Node.js 24 LTS. Clone the repository with Git or extract the source archive. From the project root:

```sh
npm ci
npm run setup
npm run dev
```

Use port 3000 on your local machine. Setup generates an ignored `.env`, creates/migrates the SQLite database, and asks for an owner email and a hidden password of at least 12 characters. There is no default account. Both the web application and job runner must run for synchronization and confirmed sends to progress.

For a production build:

```sh
npm run build
npm start
```

Both commands bind the web server to loopback by default. Read the deployment guide before exposing it through HTTPS. The application cannot run as a static export or wholly inside a Cloudflare Worker.

## Connect Hostinger

1. Sign in and open **Settings**.
2. Enter the authorized mailbox and password in the secure form. The default mailbox is `support@grantpublishingco.com`.
3. Use `smtp.hostinger.com:465` with implicit TLS; port 587 with required STARTTLS is also supported. Use `imap.hostinger.com:993` with TLS. Change these if your Hostinger product uses other settings.
4. Save, then run **Test SMTP** and **Test IMAP** separately. Credentials are encrypted at rest and never returned by the API.
5. Add an owner-controlled address to **test recipients**. Test mode is enabled initially. Do not use live prospect addresses during development.
6. Add that test address as a prospect, compose, save, preview and explicitly confirm a send. Watch **Sent Emails** for the actual result. SMTP acceptance does not confirm recipient delivery.
7. Reply from the controlled mailbox and use **Sync inbox**, or wait for the two-minute poll. The runner must be active.

An accepted message is preserved in the IMAP Sent folder using its original MIME and Message-ID. Configure a folder override if the server does not advertise a special-use Sent folder. **Reconcile Sent** searches before appending; an uncertain send or interrupted append is never blindly retried.

## Configure public tracking

Tracking is off by default and is optional for ordinary sending. A local application needs a deployed public HTTPS Worker to receive tracking signals. Follow [Cloudflare setup](docs/cloudflare.md) to create D1, apply migrations, set the shared secret and deploy. Set `TRACKING_BASE_URL` and `TRACKING_SYNC_SECRET` in the local `.env`, then restart both processes.

With the Worker connected, outreach also receives a confirmed-POST unsubscribe link. The runner refreshes public opt-outs before SMTP submission. Worker outages pause sends while active public unsubscribe links exist. Reply-based opt-out instructions and local Do Not Contact work without Cloudflare.

**An open signal is an image request, not evidence of reading.** Privacy proxies, caching, scanners and automation can create or hide signals. Raw requests are deduplicated and retained for 90 days; per-message totals may cover a longer period.

## Useful commands

| Command                              | Purpose                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `npm run setup -- --non-interactive` | Initialize secrets/database without creating an owner                           |
| `npm run db:migrate`                 | Apply committed migrations to an existing initialized database                  |
| `npm run jobs`                       | Run background work separately                                                  |
| `npm run typecheck`                  | Check application and Worker types                                              |
| `npm run lint`                       | Check application, scripts and tests                                            |
| `npm test`                           | Application integrations and Worker/D1 tests                                    |
| `npm run build`                      | Generate Prisma client and build Next.js                                        |
| `npx playwright install chromium`    | Install a test browser if no system Chromium exists                             |
| `npm run test:e2e`                   | Desktop/mobile browser checks against an isolated fixture database; build first |
| `npm run backup`                     | Consistent SQLite backup while the application is running                       |
| `npm run cf -- <arguments>`          | Run Wrangler in the Worker workspace with local log storage                     |

`.env.example` documents environment overrides. GUI mailbox settings are used unless `MAILBOX_PASSWORD` is configured in the environment. Environment overrides require a real raw local secret; HTTPS-proxy placeholder secrets cannot authenticate SMTP/IMAP or compute HMACs.

## Documentation

- [Architecture and security boundaries](docs/architecture.md)
- [Implementation checklist](docs/implementation.md)
- [Windows setup](docs/windows.md)
- [Cloudflare Worker and D1](docs/cloudflare.md)
- [VPS deployment and database migration](docs/deployment.md)
- [Owner-controlled acceptance test](docs/verification.md)
- [Privacy, retention and recipient requests](docs/privacy.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Executed validation and remaining limitations](docs/validation.md)

This version is single-owner, single-mailbox and single-host. It does not support bulk sends, automatic follow-up sending, outbound attachments or multi-user access. The inbox imports known prospects and downloads bounded MIME messages up to 5 MB; attachments are not stored or offered for download. Unmatched mail remains in the original mailbox. Existing Linux test results do not establish live Hostinger access, public deployment or Windows execution.
