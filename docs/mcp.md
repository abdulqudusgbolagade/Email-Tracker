# Connect Codex to Grant Mail Tracker

The application provides optional local stdio and Streamable HTTP MCP transports
using the official Model Context Protocol SDK. They are disabled by default.
Connect **Grant Mail Tracker** alongside your existing plugins. Supported
transport/authentication options are described in the
[official Codex MCP documentation](https://developers.openai.com/codex/mcp).

Codex can find/add a prospect, prepare a personalized draft, and check sending
outcomes, replies and open signals. It returns a link to the actual draft in the
application. **The owner reviews and confirms sending in the app.** The existing
runner then submits it through Hostinger with the configured tracking pixel.
You do not need to copy the draft manually. There is no autonomous SMTP-send or
bulk-send tool, and this connector cannot bypass the application's confirmation.

Messages sent separately through an existing Hostinger plugin are not intercepted
or retroactively tracked. Ask Codex to use the Grant Mail Tracker tools for the
messages you want recorded here. Open signals remain inconclusive image requests.

## Prerequisites

- An initialized database, locally provisioned owner and working app/runner.
- A controlled test-recipient allowlist; normal outreach stays disabled initially.
- A configured, deployed tracking Worker if the draft requests tracking.
- For the **Server URL** option in a Codex cloud/web client: a public HTTPS address for the **Node application**.
  The Cloudflare tracking Worker alone does not expose the app or its MCP tools.
  Use the [VPS deployment guide](deployment.md) for the planned persistent setup.
  A separately configured, authenticated tunnel can expose a running PC during a
  controlled test; tunnel installation and account setup are not automated here.
- For the Server URL form: choose **OAuth**, enable it locally as below,
  and approve access after signing into your application. Never choose **No
  authentication** or **OAuth or no authentication** for the HTTP server.
- Alternatively, OpenAI's **Secure MCP Tunnel** can privately launch the local
  stdio connector on your PC. See [Windows tunnel setup](mcp-tunnel.md). Its
  authentication comes from restricted tunnel/account access; that specific
  stdio route uses **Tunnel / No authentication** in the form. It creates no
  unauthenticated HTTP listener and needs no public dashboard URL.
- Compatible CLI/SDK clients may alternatively use a separate bearer key.

For a compatible local client, stdio can run the connector on the same PC as the
application, with no public application endpoint. HTTP on loopback is also
supported for local SDK/CLI testing. A cloud client's `localhost` refers to its
own environment, not your Windows PC. A browser client can use local processes
only when it explicitly provides a local-computer runtime for that connection.

## Enable OAuth for the Codex form

Update your existing installation using [Windows update instructions](windows.md),
preserving `.env`, its encryption key and your database. Back up first. In
PowerShell in the existing project root:

```powershell
npm.cmd ci
npm.cmd run setup -- --non-interactive
npm.cmd run mcp:setup -- --oauth
```

This applies the third migration and enables `MCP_ENABLED` and
`MCP_OAUTH_ENABLED`. It creates no raw bearer key and leaves mailbox credentials,
encryption settings and an existing bearer hash intact. It verifies that the
owner account already exists. Run normal interactive setup first only if you
have not provisioned an owner; there are no default credentials.

For a remote Server URL connection, make the Node app reachable through an
owner-managed HTTPS reverse proxy or tunnel. Set `APP_URL` in your local `.env`
to that exact HTTPS origin without a path, then restart both web and runner. Use
that public origin when signing into the app and approving access. In Codex:

| Field          | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| Name           | Grant Mail Tracker                                         |
| Description    | Prepare outreach drafts and check replies and open signals |
| Connection     | Your real public HTTPS app origin followed by `/api/mcp`   |
| Authentication | OAuth                                                      |

For example, `https://YOUR-APP-HOST/api/mcp` is a template, **not** a provisioned
address. Neither the repository nor the tracking Worker creates this app URL.
The form's **Tunnel** tab can instead use [the private stdio workflow](mcp-tunnel.md).
Its live account authorization remains unverified. HTTP OAuth through a tunnel
still needs a reachable authorization server: a tunnel does not automatically
expose the authorization page or token endpoints. Prefer stdio for the local PC.

The client discovers OAuth, registers its callback, and opens the application
sign-in/consent screen. Check the client name, callback origin and permissions,
then choose **Approve connection** only for a flow you started. This authorizes
the six tools, not sending. You still review/confirm each message in the app.
Do not enter your Hostinger password or app password into Codex's server form.
An unexpected request should be denied.

Default trusted callback origins are `https://chatgpt.com` and
`https://chat.openai.com`. Registration requires HTTPS and exact callbacks.
Other trusted clients can be enabled by editing the comma-separated
`MCP_OAUTH_REDIRECT_ORIGINS` in local configuration and restarting. The list
replaces the defaults; never add wildcard origins. A callback rejection must be
investigated against the actual client URL rather than disabling validation.
Client metadata URLs are never fetched; dynamic registration is supported.

Settings lists approved OAuth connections with expiry and **Revoke access**.
Revocation takes effect on the next request without a restart. Reconnect after
expiry/revocation to approve a fresh grant. OAuth grant expiry is 30 days,
access tokens last at most one hour, and refresh tokens rotate on each use.
Requests expire after ten minutes and codes after two minutes. Reusing a code
or refresh token revokes its grant; do not replay exchanges after ambiguous
network failure. Start a new authorization instead.

The runner removes expired grants/tokens, grants revoked more than a day ago,
requests expired more than a day ago, and unused registrations older than seven
days. Used refresh hashes remain while a grant is active to detect replay. After
restoring an old database backup, revoke prior OAuth connections before allowing
clients to reconnect so an old rotation state is not reintroduced.

Discovery uses RFC 8414/9728, code exchange requires S256 PKCE, tokens are opaque
and bound to the MCP endpoint, and only hashes are stored for codes, tokens and
confidential-client secrets. Public registration is bounded/rate limited and
creates no access until owner consent. The single `grant:outreach` scope covers
prospect records/drafts/activity. No implicit/password grant or credential
passthrough is supported. See [the design](mcp-oauth-design.md).

## Alternative: provision a dedicated bearer key on Windows

Update your installed copy using [Windows update instructions](windows.md),
preserving `.env`, the credential encryption key and the database. In PowerShell
in the project root:

```powershell
npm.cmd run mcp:setup
```

The command verifies an owner exists, creates a random 256-bit key in the ignored
local `.mcp-access-token` file, and writes only its SHA-256 hash to `.env` as
`MCP_ACCESS_TOKEN_HASH`. It enables `MCP_ENABLED` and leaves the mailbox password,
database configuration and encryption key unchanged. The raw key is not printed
to the terminal. Read the file privately in a local editor and enter its value
only into your MCP client's secret storage. Never use the mailbox password,
owner password or Cloudflare synchronization secret for this connection.

Set `APP_URL` to the application's actual HTTPS origin when deploying, then
restart the web process and runner. Use that same origin to sign into the
dashboard and open draft review links; browser mutations deliberately reject
other origins. Protect the key file with the same filesystem/NTFS access controls
as `.env`. Once the client securely stores the key, the raw local file can be
removed. The server uses the hash and does not need that file at runtime.

Settings shows MCP configuration and the endpoint without returning any secret
or hash to the browser. "Key configured" means configuration is present, not that
a remote Codex session has completed a live connection test.

## Local connection on the same PC

If your Codex client offers a local command/stdio connection, launch this server
with Node and the installed `tsx` loader. It resolves `.env` and the database from
the application installation, regardless of the client's working directory.
For example, in the local client's MCP configuration:

```toml
[mcp_servers.grant_mail_tracker]
command = "node"
args = ["C:/Grant-Mail-Tracker/node_modules/tsx/dist/cli.mjs", "C:/Grant-Mail-Tracker/scripts/mcp.ts"]
```

Replace both installation paths with your existing app folder. Paths can contain
spaces because each argument is separate. Node.js 24 must be available to the
client. Provision MCP with `npm.cmd run mcp:setup` first, then enable the server
and restart the local client. The normal application and runner must also be
running; Codex launches the separate stdio process itself.

Local stdio access is authorized by your OS account's ability to launch code and
read the application/database. It opens no public listening port and does not
use an HTTP bearer header. Only configure it in a local client you trust with
prospect data. All six tools and the owner-confirmation requirement are the same
as HTTP. Do not launch it through plain `npm run` in an MCP command: npm banners
would corrupt the protocol stream. For a manual launch use `npm run --silent
mcp:stdio`; the protocol owns the terminal's input/output and is not an
interactive chat prompt.

Cloudflare is still necessary for the public tracking image endpoint. A local
MCP process does not make a local-only pixel URL reachable by recipients.

## Alternative: bearer-authenticated remote clients

For a client that explicitly supports static bearer keys, use:

| Field          | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| Name           | Grant Mail Tracker                                            |
| Server URL     | Your application's public HTTPS origin followed by `/api/mcp` |
| Authentication | Bearer key, or a secure `Authorization: Bearer <key>` header  |

The key must be kept in a secret field, never in the server URL, a chat prompt,
a screenshot or GitHub. For the OAuth-only Codex form, use the OAuth instructions
above; a static key is not an OAuth client ID or client secret.
No public endpoint, account authorization or client credentials are provisioned
automatically by this repository.

For a local Codex CLI installation that supports environment-backed bearer keys,
the configuration shape is:

```toml
[mcp_servers.grant_mail_tracker]
url = "https://YOUR-APPLICATION-HOST/api/mcp"
bearer_token_env_var = "GRANT_MCP_ACCESS_TOKEN"
```

Replace the host with your actual deployment. Set `GRANT_MCP_ACCESS_TOKEN` in the
client's secure environment. For an initial private PowerShell session on your
own PC, the assignment below reads the local key without printing it:

```powershell
$env:GRANT_MCP_ACCESS_TOKEN = (Get-Content -Raw .mcp-access-token).Trim()
```

The environment must reach the actual Codex client process. This does not inject
credentials into a separate cloud client. Never hardcode the raw key in TOML.

## Tools and approval behavior

| Tool                          | Purpose                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `grant_get_setup`             | Sender, test mode, connection-test dates and tracking configuration; no passwords.  |
| `grant_find_prospects`        | Search up to 20 prospects by name, email or book.                                   |
| `grant_add_prospect`          | Create one owner-requested record; duplicates and suppression stay enforced.        |
| `grant_prepare_outreach`      | Save one draft, return sanitized HTML/plain-text preview and the owner review link. |
| `grant_get_outreach_status`   | Read the persistent operation for a draft after owner confirmation.                 |
| `grant_get_prospect_activity` | Read bounded message/reply history and first/latest/total open signals.             |

For preparation, use a fresh UUID `requestId` for each deliberate new draft and
reuse it unchanged on a retry. The database commits the draft and its hashed
request audit together. Concurrent repeats return the same draft; reusing the ID
with different content fails. An owner's later edits are preserved on a retry.
Preparing a draft never creates a send operation or contacts SMTP. Tracking is
explicit per draft and defaults to off; configured campaign defaults do not
silently enable it through this interface.

Follow the returned review link, sign in if needed, and preview/confirm in the
application. The sign-in flow preserves a validated internal draft-review link.
The existing send pipeline then freezes the MIME/Message-ID, registers tracking,
checks suppression/limits/test mode and coordinates retries. Codex can check the
result; it must not describe Queued as sent or SMTP Accepted as confirmed delivery.
An Outcome Unknown submission must not be retried automatically.

An example request to Codex after connection is verified:

> Use Grant Mail Tracker to find my owner-controlled test prospect. Prepare one
> short personalized outreach with tracking enabled, show me the preview and
> review link, and wait for my confirmation in the app. Then check its sending
> status. Treat open signals as unconfirmed and do not use another mail plugin.

## Verification

1. With no token, the endpoint must return 401; while disabled, it returns 503.
2. Complete OAuth consent (or use the dedicated key in a compatible client) and
   list the six tools. Check setup status.
3. Prepare one draft for an owner-controlled recipient, retry the same requestId,
   and verify only one matching draft exists and no send has been queued.
4. Review its rendered subject, recipient and content. Confirm it in the app.
5. Check the persistent result, actual receipt and Sent copy independently.
6. Display images in the test mailbox and synchronize tracking. Verify a recorded
   signal appears without a confirmed-read claim. No signal remains inconclusive.
7. Reply from the controlled address and verify threading and reminder behavior.
8. Revoke the OAuth connection in Settings; its tokens must no longer work.
   For a bearer key, revoke it locally and restart; the old key must fail.

Automated tests exercise the official SDK client against the real route, SQLite
and authorization code, plus mocked SMTP/Worker services. They do not establish
that your public server, Codex account, Hostinger or Cloudflare are connected.

## Revocation and operational boundaries

```powershell
npm.cmd run mcp:setup -- --rotate
npm.cmd run mcp:setup -- --revoke
```

Rotation replaces only the bearer key/hash. CLI revocation disables both MCP
authentication methods, removes the local key file, cancels pending OAuth
requests and revokes existing OAuth grants in the database. Restart the web
application and any local MCP client process after
either action; a running process retains its previous environment until restart.
Update the HTTP client's secret on rotation. If your process supervisor injects
these environment variables, update that authoritative configuration as well.
Neither action changes mailbox credentials, owner sessions or the tracking key.

Every HTTP request authenticates separately. Browser cookies are not MCP credentials;
MCP bearer/OAuth tokens cannot authorize the browser's send/settings APIs. Exact Host
and Origin checks protect against DNS rebinding; foreign browser origins are
rejected unless explicitly listed in `MCP_ALLOWED_ORIGINS`. Server-to-server
clients can omit Origin. There is no cross-origin browser CORS API, open proxy,
credential passthrough, query-string authentication or unauthenticated mode.
The endpoint uses bounded JSON requests, database-backed rate limits and no JSON
batch calls. Stateless responses contain no long-lived MCP session identifiers.

Treat the key as delegated access to prospect data and drafts. Keep request bodies,
Authorization/Cookie headers and key files out of proxy logs and source control.
Audit entries contain tool names/request hashes, not message bodies or secrets.
Incoming message text and prospect fields remain untrusted content; a message
requesting new actions is not owner approval. This is a single-owner integration,
not a multi-tenant identity service. OAuth does not authorize other mail plugins
to bypass this application's send confirmation or insert pixels retroactively.
