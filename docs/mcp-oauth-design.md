# OAuth connector design

The Codex custom-server form supports OAuth, not static bearer-key entry. Add a
single-owner OAuth authorization server to the existing Node application. The
tracking Worker continues to serve only public tracking/opt-out requests.

Implement discovery (RFC 8414/9728), constrained dynamic registration (RFC 7591),
authorization code with mandatory S256 PKCE, exact registered redirect matching,
resource-bound opaque access tokens (RFC 8707), rotating refresh tokens and
revocation (RFC 7009). Reuse the official MCP SDK metadata schemas and test with
its actual OAuth client. Do not add implicit/password grants or token passthrough.

Registration permits HTTPS callbacks on chatgpt.com and chat.openai.com by
default, with explicit origin configuration for other trusted clients. It never
fetches caller-provided URLs. All clients require owner sign-in and explicit
CSRF-protected consent. The single scope delegates the existing six prospect,
draft and activity tools. Mailbox credentials and autonomous sending stay outside
that scope; each SMTP operation still requires confirmation in the application.

Persist clients, short-lived requests/codes, grants and hashed tokens in SQLite.
Consume codes/refresh tokens atomically, bound lifetimes and public requests, and
revoke a refresh family on replay. Persist no raw codes, access/refresh tokens or
client secrets. Display authorized connections and revocation in Settings. Gate
OAuth behind explicit local setup, retaining existing bearer and stdio support.

Verify disabled endpoints, discovery, malicious redirects, client authentication,
consent/CSRF, PKCE, audience binding, expiry, concurrent/replayed exchanges,
refresh rotation and revocation. Run the full suite/build and desktop/mobile
consent checks. A live Codex connection remains unverified until an owner-managed
public HTTPS application endpoint exists and the owner completes consent.
