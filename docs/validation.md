# Validation report

Validated on Linux with Node.js 24.19.0 and npm 11.9.0, on 24 October 2026. These results describe this machine and local test integrations. No live Hostinger authentication, prospect email or public Cloudflare deployment was performed.

| Check                              | Result                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application unit/integration suite | **78 passed**, including a real local SMTP sink, temporary SQLite databases, authenticated API requests, mocked IMAP reconnection, accurate open-signal status rendering, both MCP transports and OAuth                          |
| Cloudflare Worker/D1 suite         | **7 passed** in the real local Workers runtime with D1 bindings                                                                                                                                                                  |
| Chromium end-to-end suite          | **12 passed**: six workflows on desktop and mobile viewports                                                                                                                                                                     |
| Type checking                      | Application, Next.js route types, Worker and tests passed                                                                                                                                                                        |
| ESLint                             | Passed                                                                                                                                                                                                                           |
| Production build                   | Passed                                                                                                                                                                                                                           |
| MCP protocol and access boundary   | Official SDK HTTP client and a real local stdio child process passed; disabled endpoint, key authorization, Host/Origin checks, bounded requests, request limits, idempotent preparation and owner-only send confirmation tested |
| Locked installation                | `npm ci` passed; official engine checksum verification retained                                                                                                                                                                  |
| Database initialization            | Three committed migrations applied, including OAuth records; repeat setup reports no pending migrations                                                                                                                          |
| Consistent backup/restore          | Automated test restored a database containing records and passed SQLite integrity checking                                                                                                                                       |
| Production startup                 | Web process and independent job runner started; live database health returned 200 and runner heartbeat was recent                                                                                                                |
| Access boundary                    | Login page returned 200; private page redirected to login; anonymous data/export access rejected                                                                                                                                 |
| Live database fixture isolation    | Zero owner, prospect, message or send-operation fixtures seeded into the actual application database                                                                                                                             |

## Behaviors exercised

- Session hashing/expiry, incorrect-password rejection, login throttling, same-origin/CSRF rejection, protected reads/exports/mutations and authenticated credential encryption.
- Email normalization, duplicate prevention, suppression persistence, CSV row errors, campaign-reference validation before import and spreadsheet-safe exports.
- Sanitized rich text, escaped personalization, missing-placeholder rejection, plain-text alternative, signature/opt-out footer and one pixel only in outbound MIME.
- Concurrent confirmation, immutable revisions, idempotent retry after acceptance, test-recipient enforcement, rolling limits, explicit SMTP rejection and ambiguous network outcomes.
- Sent-folder discovery, provider-saved copy detection, original-MIME append, interrupted-append uncertainty and no SMTP resubmission for copy failures.
- Header-based threading with sender matching, subject-only mismatch, UIDVALIDITY changes, replayed imports, interrupted synchronization recovery, monotonic checkpoints, automatic responses and delivery-status notices.
- Calendar-day reminders across timezones/DST, one pending reminder per conversation, accepted-send postprocessing recovery, human-reply cancellation and unsubscribe suppression.
- Unpredictable-token validation, proxy/automation classifications, GIF response under logging failure, HMAC expiry/tamper/replay rejection, cursor pages, event deduplication, unsubscribe GET/POST separation, deletion and retention cleanup.
- Desktop/mobile navigation, actual prospect creation/editing, personalized draft preview, confirmation gating, blocked unconfigured sending, settings persistence, campaign creation and CSV import.
- Explicit distinction between Tracking off, No signal recorded and Open signal recorded; synchronized first/latest times in Africa/Lagos; no pixel loading from the status display. The additional browser scenario uses response fixtures only inside the test and checks desktop/mobile layout without adding fake messages to any live database.
- MCP credential provisioning/rotation/revocation in temporary files without printing raw keys; preservation of mailbox/encryption settings; official SDK initialize/list/call over stateless HTTP and a real local stdio process; normal browser sessions cannot authorize MCP and the MCP key cannot authorize the browser send API.
- MCP draft retries/concurrency, unchanged request IDs, owner edits, normalization/duplicate/suppression rules, sanitized previews without pixels, browser-confirmed tracked MIME with mocked SMTP/Worker and unconfirmed open-signal reporting. Disabled-by-default behavior is covered in integration tests. Actual HTTP browser checks reject anonymous MCP requests and preserve an internal draft-review link through the login redirect; external redirect targets are rejected in unit tests.
- OAuth discovery/registration and a complete PKCE flow using the official SDK OAuth client; exact callback/Host checks, malicious redirect and scope/audience rejection, public/confidential clients, hashed code/token/client-secret persistence, expiry, duplicate/concurrent code consumption, rotating refresh tokens with replay-family revocation, and owner-only connection revocation. Browser checks use real Next.js endpoints and a locally intercepted trusted callback for login/deny/approve/tool access/revoke on desktop and mobile. Production login limits remain unchanged; the expanded suite reuses authenticated worker sessions and explicitly clears state for anonymous checks.

The mobile checks exposed long-dialog hit-target and horizontal-table problems during development; bounded mobile dialogs, explicit form labels and responsive record cards resolved them. The final full browser run passed.

## Reproducibility and retained state

The npm cache and Linux Prisma engine cache use ignored directories inside the workspace. The verified engine's SHA-256 matches its cached official checksum. No TLS, checksum, signature or assertion checks were disabled. The isolated SMTP sink intentionally uses an unencrypted loopback transport; the application transport always requires verified TLS or STARTTLS.

The retained filesystem includes dependencies, generated Prisma client, production build, an empty migrated live database and a locally generated encryption key in ignored `.env`. Live processes must restart in a new task. No owner account or real mailbox password was invented. The owner must run interactive setup before signing in.

## Unrun external checks and limits

- **Hostinger:** real credentials have not been supplied. SMTP/IMAP authentication, provider-specific Sent behavior, real reply arrival and recipient delivery require the controlled-mailbox checklist.
- **Cloudflare:** account authorization, D1 creation, remote migrations, Worker deployment and public HTTPS tracking/unsubscribe behavior require the owner's account. Local D1 tests do not establish deployment readiness.
- **Windows:** the initial-release CI subsequently passed on actual Windows and Linux runners; see the evidence below. This cloud machine remains Linux.
- **Publication:** saving the environment draft does not publish it or prove restoration in a fresh cloud task. Review/save and publish through environment settings, then validate a new task separately.
- **Version scope:** single owner, one mailbox, one host with persistent SQLite. No outbound attachments, bulk campaign sending or automatic follow-up sending. MIME imports are bounded to 5 MB and known prospects.

See verification.md for the owner-controlled live test and troubleshooting.md for actionable failure handling.

## Saved cloud configuration

The complete `install_script` (`npm ci`, noninteractive setup, production build) was executed successfully as one sequence after a fresh reinstall. `start_skill` records retained files, process restart, authentication/health checks, owner provisioning, test-only sending and the remaining live-verification steps.

The draft save was confirmed. It includes these installation/startup instructions and preserves existing network presets while adding the exact custom destinations `binaries.prisma.sh`, `smtp.hostinger.com` and `imap.hostinger.com`. The deployed Worker hostname remains an owner-specific addition once known. No credential values were saved in the draft.

Review and save the draft in environment settings, then publish the environment. Publication and validation in a fresh task have not been performed.

## Subsequent CI and owner-reported evidence

[GitHub Actions run 40013878998](https://github.com/abdulqudusgbolagade/Email-Tracker/actions/runs/40013878998)
completed successfully for MCP connector commit
`0279c8178beeb6217b243962ae7951c058ec0dc0`. Both Windows and Linux runners passed
locked installation, database setup, type checking, lint, all 64 application and
7 Worker tests, production build and all 10 browser checks. This includes the
HTTP and stdio connector tests; it does not establish a live Codex connection.

[GitHub Actions run 39993097603](https://github.com/abdulqudusgbolagade/Email-Tracker/actions/runs/39993097603)
completed successfully for commit `9fff314e00b96a441966d3a6c1cc5daa6db86e1d`.
Both `check (ubuntu-latest)` and `check (windows-latest)` passed installation,
noninteractive setup, type checking, lint, application/Worker tests, production
build and browser acceptance tests. These results establish Windows CI execution
for that source version, rather than implying this Linux workspace is Windows.

The owner has also provided screenshots of successful account provisioning and
the application running on their Windows PC. They report successful mailbox
connection checks and receipt of a controlled test message. Gmail's received
message summary shows SPF PASS, DKIM PASS with the sender's domain, and DMARC
PASS. These are owner-provided live-provider observations, separate from the
automated local SMTP/IMAP tests. The message landed in Gmail spam, including a
comparison sent through Hostinger webmail. Inbox placement and the precise reason
for Gmail filtering remain unresolved; provider investigation is pending.

Public Cloudflare activation remains unrun: the owner reports creating an account,
but Wrangler authorization, D1/Worker deployment and a new tracked-message check
remain pending. No Cloudflare credentials were requested in chat or placed in
GitHub. The optional MCP connector can now prepare drafts, provide an owner review
link and read outcomes/signals. A compatible local client can launch its stdio
process; remote HTTP clients require a reachable HTTPS application endpoint and
OAuth or bearer authentication. Neither mode has been connected to the owner's
actual Codex account. Each send is confirmed in the app; autonomous SMTP
submission is not exposed through MCP. OAuth client authorization is implemented
and tested locally; the actual client-managed Tunnel option remains unverified.
The acceptance tests used the official MCP SDK clients and isolated fixtures,
not a live Codex session. Earlier Windows/Linux CI evidence above applies to
the exact commits identified; the latest OAuth change needs its own CI result.

The official Secure MCP Tunnel documentation confirms private stdio forwarding
is supported. The documented setup uses a restricted runtime key and associated
workspace/organization access, not unauthenticated public HTTP. The owner must
create/authorize the actual tunnel on their PC; no real polling or account tool
call has been performed here.

The official Linux `tunnel-client` v0.0.18 ZIP was SHA-256-verified against the
GitHub release asset digest. Its quickstart/sample/init help ran successfully,
and initialization in a temporary profile accepted the exact documented Node
stdio command, retained `env:CONTROL_PLANE_API_KEY` and bound health to loopback.
No runtime key was supplied and doctor/polling were not run. This command check
does not establish Windows binary installation or a live OpenAI tunnel.
