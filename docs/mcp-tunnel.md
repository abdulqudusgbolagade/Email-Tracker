# Connect the Windows app through Secure MCP Tunnel

This is the private-PC alternative to a public Server URL. OpenAI's official
[Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)
describe the supported transport. The tunnel client makes outbound HTTPS
connections; it launches this app's existing stdio MCP server locally. The
dashboard remains on loopback and does not need a public URL or VPS for this
connection. Your PC, the app/runner and tunnel client must remain running.

The application still sends only through your configured Hostinger mailbox.
OpenAI's runtime API key authenticates the tunnel transport; it is not an email
provider credential. Cloudflare remains the separate public tracking-image
endpoint. No tunnel can retrofit a pixel into mail sent through another plugin.

## Account prerequisites

1. Open [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels)
   in the same OpenAI account. Create or reuse a tunnel for Grant Mail Tracker.
2. Associate the intended Platform organization **and** your ChatGPT workspace;
   also include the organization Codex uses. A tunnel associated only with a
   Platform organization may not appear in the ChatGPT/Codex picker.
3. Tunnel creators need **Tunnels Read + Manage**. The plugin operator and
   restricted runtime-key principal need **Tunnels Read + Use**. These permissions
   are separate from a ChatGPT subscription and custom-plugin permissions. If
   the page reports missing access, resolve it with the account/organization
   administrator; no app code or invented ID can bypass that requirement.
4. Create a restricted **runtime** key at
   [organization API keys](https://platform.openai.com/settings/organization/api-keys).
   Do not use an admin key for the running client. Enter the runtime key only on
   your own PC using the hidden prompt below; never send it in chat.

Keep the actual tunnel ID locally for the client and form. `tunnel_...` is a
placeholder and is not usable. Do not create a public/distributed plugin for
this private mailbox integration.

## Prepare the local application

Update the existing installation using [Windows instructions](windows.md),
backing up and preserving `.env`, `data` and the credential encryption key.
In PowerShell in the project root:

```powershell
npm.cmd ci
npm.cmd run setup -- --non-interactive
npm.cmd run mcp:setup
npm.cmd run dev
```

Skip `mcp:setup` if already enabled, preserving the key. This enables the local
connector and separately protects its optional HTTP endpoint. Its bearer key
is **not** entered in the Tunnel form; stdio access is granted by the OS user
launching the process and by OpenAI's tunnel permissions. You do not need to
enable OAuth or change the local `APP_URL` for this stdio route. OAuth remains
available for a future public HTTPS application deployment.

## Install the official tunnel client

Use the download in Platform tunnel settings or the
[latest official release](https://github.com/openai/tunnel-client/releases/latest).
Choose the normal **tunnel-client Windows amd64** ZIP for an Intel/AMD Windows PC
or the Windows arm64 ZIP for an ARM PC. Verify its SHA-256 using the same
release's `SHA256SUMS.txt` before running it:

```powershell
Get-FileHash "C:\PATH\TO\DOWNLOADED-ZIP.zip" -Algorithm SHA256
```

Extract it into a trusted local folder. The commands below assume
`tunnel-client.exe` is on PATH; otherwise replace `tunnel-client` with `&` and
its actual quoted executable path. The repository does not bundle a binary.

## Configure and run on the PC

Open a **second PowerShell** in the project root. The stdio command uses paths
relative to this folder; run the tunnel from here every time. First inspect the
installed client help:

```powershell
tunnel-client help quickstart
```

Read the runtime key without echoing or writing its literal value to shell
history/configuration. These are PowerShell commands, not Node REPL input:

```powershell
$grantSecureKey = Read-Host "OpenAI tunnel runtime key (hidden)" -AsSecureString
$grantKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($grantSecureKey)
try {
  $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($grantKeyPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($grantKeyPointer)
  $grantSecureKey.Dispose()
}
$grantTunnelId = Read-Host "Tunnel ID from Platform settings"
tunnel-client init --sample sample_mcp_stdio_local --profile grant-mail-tracker --tunnel-id $grantTunnelId --mcp-command 'node node_modules/tsx/dist/cli.mjs scripts/mcp.ts'
tunnel-client doctor --profile grant-mail-tracker --explain
```

Use a new profile only when needed; inspect/reuse an existing suitable profile.
The API key must remain an environment reference in configuration. Do not paste
it into a command argument, YAML field, `.env`, screenshot or source control.
Keep the runtime-key environment limited to this terminal and its trusted child
processes. This procedure does not persist the key for the next session.

If doctor succeeds, start the foreground client and leave the terminal open:

```powershell
try {
  tunnel-client run --profile grant-mail-tracker
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
```

Check its loopback-only `/ui`, `/healthz` and `/readyz` using the port the client
reports (normally 8080). Successful local MCP discovery alone does not prove
active OpenAI polling: verify **healthy, ready and connected**, then make an
actual safe plugin call. Do not run two stdio tunnel-client instances sharing
the same tunnel ID. Stop with Ctrl+C. Restart the app and tunnel after a reboot.

## Complete the Codex form

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Name             | Grant Mail Tracker                                        |
| Connection tab   | Tunnel                                                    |
| Connection value | The same real tunnel ID, or its entry in the picker       |
| Authentication   | No authentication, **only for this private stdio tunnel** |

This choice means no additional OAuth layer on the local stdio protocol.
Restricted OpenAI tunnel permissions and the runtime key protect the connection;
the app's HTTP API continues to require authorization. Never apply this choice
to an Internet-facing Server URL or remove HTTP authentication. OAuth through
an HTTP tunnel needs a separately reachable OAuth server; merely entering
localhost in its metadata will not make it reachable to cloud token callers.

After reviewing the actual tool scope/risk notice, create the private plugin.
Ask Codex to call **grant_get_setup** and verify the configured mailbox/test mode.
Do not ask it to display keys or passwords. Setup is complete only after that
actual call succeeds; then follow the controlled send/reply/signal checklist in
[mcp.md](mcp.md). Each email still requires owner confirmation in the app.

## Verification boundary

The application stdio MCP server and six tools have automated protocol tests.
The official client's published help/profile commands were inspected. This is
not a claim that your account has tunnel access, that Windows has installed the
binary, or that live tunnel polling/plugin calls passed. Account association,
runtime authorization and a representative Codex tool call require your own PC
and account. No runtime/admin key or tunnel ID is included in the repository.

To remove access, unlink the private plugin, stop the tunnel client, revoke its
restricted runtime key and remove unwanted workspace/organization associations
in Platform. Disable the local connector with `npm.cmd run mcp:setup -- --revoke`
and restart the app/local MCP processes. Existing app data is preserved.
