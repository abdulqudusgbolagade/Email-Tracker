# Architecture

Grant Mail Tracker is a single-owner Next.js Node application plus a restartable Node job runner, sharing a persistent SQLite database through Prisma. The public Cloudflare Worker stores token hashes and minimal events in D1; it never receives mailbox credentials, message bodies or prospect email addresses.

The server is the security boundary. Every private route verifies an opaque, expiring, database-backed session. Mutations verify Origin and a session-bound CSRF token. The owner is provisioned locally using a hidden terminal password prompt; there is no default password or public signup. Credential encryption uses an independently generated AES-256-GCM key in the ignored .env file.

An explicit confirmation creates an immutable message and a unique send operation in one database transaction. Only queued operations are eligible for SMTP. A process failure after submission is ambiguous and must not trigger automatic retransmission. SMTP acceptance is not delivery. IMAP Sent reconciliation uses Message-ID and never resends SMTP because a copy failed.

IMAP imports use folder UIDVALIDITY/UID checkpoints with transactional import-before-checkpoint ordering. A database lease coordinates background and manual runs. Reply matching uses references and a validated sender, never subject alone. Automated responses and delivery-status notices do not qualify as human replies.

Tracking is off by default. A 256-bit random token is registered before submission; D1 stores its SHA-256 hash. Signed administrative requests expire, have unique nonces and are replay-protected. Cursor ingestion is transactional and idempotent. Pixel requests always return an image. Requests are signals only; proxies, caching and automation make reads unknowable.

Local operation binds to loopback. Future deployment uses an HTTPS reverse proxy, one Next.js process, one supervised runner and a persistent disk. SQLite is deliberately single-host. Horizontal scaling requires PostgreSQL and distributed job coordination. Cloudflare Workers cannot host the current SMTP/IMAP application.

No bulk sending, automatic follow-ups, attachments or multi-user access in v1. MIME downloads are bounded to 5 MB; attachment content is not retained or exposed. Unmatched senders are not imported as unsolicited new CRM records.

## Implementation gates

1. Foundation: schema, migration, owner/session security, shell and health.
2. CRM: prospect/campaign CRUD, CSV validation, suppression, backups.
3. SMTP: composition, frozen MIME, explicit idempotent sends, Sent copy.
4. IMAP: threading, resumable synchronization, reminders.
5. Worker: tracking, unsubscribe, authentication, cursor synchronization.
6. Product: all navigation, database analytics, operational documentation and end-to-end validation.

Tests exercise temporary databases and owner-controlled addresses only. Automated tests do not establish Hostinger connectivity or a deployed Worker. Record each kind of validation separately in docs/validation.md.
