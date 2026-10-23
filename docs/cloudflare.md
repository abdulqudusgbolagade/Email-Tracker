# Cloudflare Worker and D1

The Worker receives public HTTPS pixel requests while the main application can remain local. It stores **token hashes, event identifiers, timestamps and coarse classifications**. It never receives prospect addresses, message bodies or mailbox credentials.

## Deploy using your account

Run from the repository root. These commands require your Cloudflare authorization and are not run automatically by application setup:

```sh
npm run cf -- login
npm run cf -- d1 create grant-mail-events
```

Copy the returned database ID into `workers/tracking/wrangler.jsonc`, replacing the marked placeholder. The rate-limit binding uses namespace `1001`; choose a different numeric namespace if it conflicts with another Worker in your account.

```sh
npm run cf -- d1 migrations apply grant-mail-events --remote
npm run cf -- secret put SYNC_SECRET
npm run cf -- deploy
```

Supply a random shared secret of at least 32 characters to Wrangler's secure prompt. Put the identical value in `TRACKING_SYNC_SECRET` in the main application's ignored `.env`. Do not put it in the Wrangler configuration or commit it. Put the deployed HTTPS origin, with no extra path, in `TRACKING_BASE_URL`. Restart the web process and runner.

For a custom tracking subdomain, configure its Worker route/domain in Cloudflare and use that exact HTTPS origin. Workers.dev is sufficient for an initial owned-mailbox test. A domain by itself does not establish that D1 migrations, secrets or public routing work.

If the cloud execution environment restricts outbound destinations, allow the exact deployed Worker hostname. Mailbox integration also needs outbound SMTP/IMAP connectivity; HTTPS proxy secret substitution does not support their raw credentials. Cloudflare administration may require allowing `api.cloudflare.com` and the interactive authorization destinations reported by Wrangler. Do not replace an unknown network allowlist.

## Local Worker tests

```sh
npm run test --workspace=@grant/tracking
npm run cf -- d1 migrations apply grant-mail-events --local
```

For manual Worker development, create an ignored `workers/tracking/.dev.vars` containing a development-only `SYNC_SECRET`, then use `npm run cf -- dev`. A loopback Worker URL cannot track external emails. The application's normal configuration requires HTTPS; only isolated tests permit loopback HTTP.

## Endpoints and security

| Endpoint               | Behavior                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `GET /p/<token>.gif`   | Always returns a transparent GIF; valid registered tokens can record a deduplicated signal |
| `GET /u/<token>`       | Displays an unsubscribe confirmation without changing state                                |
| `POST /u/<token>`      | Requires same-origin confirmation, then records an opt-out                                 |
| `POST /admin/register` | Registers a SHA-256 token hash, purpose and expiry                                         |
| `POST /admin/changes`  | Returns ordered event pages after a cursor                                                 |
| `POST /admin/delete`   | Revokes token hashes and deletes their remote events                                       |

Administrative requests sign `timestamp + newline + nonce + newline + method + newline + path + newline + exact JSON body` using HMAC-SHA256. Signatures expire after five minutes; D1 nonces reject replays. Keep clocks synchronized. The main application performs signing; recipient endpoints never receive the shared key.

The rate limiter bounds requests by an ephemeral daily hashed IP key and token hash. Raw IPs and full user-agent strings are not persisted in D1. Signals with the same token, minute and coarse category are deduplicated. This means counts represent retained events, not every HTTP request.

Request observability is disabled to avoid recording capability-bearing pixel/unsubscribe paths in Worker logs. Cloudflare itself still processes requests under its own service policies. Never enable full-URL logs casually.

The daily scheduled handler removes raw events older than 90 days, expired registrations and expired authentication nonces. Tokens expire after 180 days. The main runner separately applies the local raw-event retention policy. Check the Cloudflare dashboard for scheduled-handler failures and D1 quotas.

If the Worker is unavailable, pixels still attempt a valid GIF response and logging may be lost. Tracked-message registration must succeed before submission. Active public unsubscribe links require successful synchronization before any queued email is submitted; removing the configuration does not bypass this safeguard.
