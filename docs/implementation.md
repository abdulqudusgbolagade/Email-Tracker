# Implementation checklist

- [x] Foundation: owner provisioning, encrypted credentials, sessions, CSRF and limits; migrations; responsive shell; health.
- [x] CRM: all prospect fields/statuses, campaign management, history, duplicate-aware CSV preview/import, protected exports, consistent backup.
- [x] Sending: personalized HTML/plain text, drafts, preview/confirmation, immutable MIME and Message-ID, unique send operations, suppression, test mode, rolling limits and audit.
- [x] SMTP/IMAP integrations: real Nodemailer/ImapFlow adapters, independent verification, Sent-folder discovery/search/append and uncertain-append handling.
- [x] Synchronization: leases, renewable heartbeats, UID checkpoints, UIDVALIDITY changes, interrupted import recovery, header-based matching and notice classification.
- [x] Follow-ups: timezone-aware configurable intervals, manual actions, reply cancellation, accepted-send postprocessing recovery; no automatic sending.
- [x] Worker/D1: signed replay-protected administration, opaque-token pixels, deduplicated events, cursors, unsubscribe confirmation, revocation and retention.
- [x] Product screens and database metrics; Windows/VPS/Cloudflare/privacy/troubleshooting guides; Linux/Windows CI definition.
- [x] Owner reports Windows startup, owner provisioning and a controlled Hostinger send; the received Gmail message shows SPF, DKIM and DMARC PASS. Inbox placement remains under investigation.
- [ ] Owner deploys Worker/D1 and verifies public HTTPS behavior.
- [x] Initial-release GitHub CI passed on both Windows and Linux. This cloud machine remains Linux; see validation.md for the run and source version.

See validation.md for executed checks rather than treating this checklist as evidence of live service access.
