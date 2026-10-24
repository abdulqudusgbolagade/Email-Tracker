# Deploy on a Node.js VPS

Use one Linux host with Node.js 24 LTS, a persistent local disk, an HTTPS reverse proxy and a process supervisor. Cloudflare hosts the public tracking Worker separately. SMTP/IMAP require persistent Node processes and outbound mail ports; the current application is not compatible with static hosting or short-lived web functions alone.

## Initial deployment

1. Copy/clone the project into a directory owned by a dedicated unprivileged service user.
2. Run `npm ci`, then `npm run setup` interactively to create the real owner account. Configure `APP_URL` to the public HTTPS origin before login. Preserve the encryption key and database on persistent storage outside ephemeral release directories.
3. Set `DATABASE_URL` to an absolute `file:` path on that persistent disk. Run setup again to initialize/migrate that location if necessary.
4. Run `npm run build`. Supervise `npm run start:web` and `npm run jobs` as separate processes using the repository root as working directory. Both read the same environment/database. The combined `npm start` is convenient locally; separate supervised processes provide clearer production restarts.
5. Proxy your HTTPS domain to the loopback web port. Preserve the original `Origin` header. Do not expose the Node port directly. Configure request-body limits around 3 MB and appropriate proxy timeouts.
6. Test authentication, SMTP, IMAP, a controlled send/reply and the deployed tracking Worker before enabling normal outreach.

Example systemd service command structure (replace paths and service user):

```ini
[Service]
Type=simple
User=grant
WorkingDirectory=/srv/grant-mail-tracker
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start:web
Restart=on-failure
RestartSec=5
UMask=0077
```

Create a second service with `ExecStart=/usr/bin/npm run jobs`. Use the actual Node/npm installation path. Restrict `.env`, data and backups to the service user. HTTPS causes session cookies to become Secure through `APP_URL`; mismatched origins are deliberately rejected.

Example reverse proxy using Caddy:

```caddy
mailtracker.your-domain.example {
    request_body {
        max_size 3MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Configure DNS and certificate issuance for your real domain. The application does not deploy itself or grant firewall access automatically.

## Operations and upgrades

- Monitor the public database health endpoint internally and the authenticated Settings heartbeat, last-sync times and job errors. An open port alone is not readiness.
- Schedule `npm run backup` daily under the service account with the same environment and working directory. Apply an explicit backup-retention policy, for example 30 days, and encrypt off-host copies. Protect the credential key separately. Test restoration periodically.
- Before upgrades, back up and stop both processes. Install locked dependencies, run setup noninteractively to apply committed migrations, build, restart and verify health. Preserve data and `.env`; do not copy a live SQLite file as a backup.
- Do not run multiple web hosts against a shared SQLite file. The local lease coordinates runners on one database; it is not a distributed queue guarantee.
- An interrupted SMTP operation becomes Outcome Unknown. Reconcile with Sent/provider records. Never reset queued states with ad-hoc SQL or automatically retry unknown submissions.
- Keep dependency/TLS verification enabled and patch the runtime/dependencies regularly.

## Moving from Windows

Create a consistent backup on Windows, stop the old application, copy the backup and matching encryption key securely, and use an absolute Linux database path. Run migrations, start services, test the controlled workflow, then retire the Windows instance. Never operate two independent copies of the same outreach database/mailbox concurrently.

## Optional MCP endpoint

The same Node web process serves `/api/mcp` when explicitly enabled. Configure
`APP_URL` with the real HTTPS origin, enable OAuth (or a dedicated bearer key) locally and
follow [the MCP guide](mcp.md). Preserve Host and Origin through the reverse proxy;
never log Authorization/Cookie headers, key files or request bodies. The
Cloudflare pixel Worker is a separate service and cannot host the Node app's MCP
tools. Both the web process and runner must remain active for approved sends.
No changes to the Hostinger mailbox are needed to add the connector.

Expose discovery at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/api/mcp`, the `/api/mcp/oauth/*` endpoints,
and the `/mcp/authorize` consent page through the same HTTPS origin. These
endpoints enforce their own authorization; an external interactive login wall
in front of them prevents OAuth discovery. Keep the dashboard's application
authentication active. Do not log callback queries, token bodies or secret
headers. Preserve the original Host; spoofable forwarding headers are not used
to authorize requests. OAuth does not run on the pixel Worker.

## PostgreSQL migration path

Before horizontal scaling, change the Prisma datasource/adapter to PostgreSQL in a separate migration project. Create PostgreSQL migrations rather than applying SQLite SQL. Export/import records while preserving IDs, Message-IDs, send idempotency keys, token mappings, suppression and synchronization cursors. Recreate the partial unique pending-reminder index and replace SQLite-specific rate-limit SQL. Revalidate transactional claims, lease expiry, checkpoint commits and backups. Only then add multiple web instances and distributed job coordination. Never replay historical send operations during migration.
