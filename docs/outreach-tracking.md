# Outreach drafted with ChatGPT and tracked in Grant Mail Tracker

ChatGPT can help write a personalized subject and message. Copy the draft into
Grant Mail Tracker, select the prospect, preview it and explicitly confirm the
send. The application sends through your authorized Hostinger mailbox and keeps
the message, sending outcome, replies and tracking signals together.

This version has no direct ChatGPT sending integration. Sending through an
unrelated mail tool, Hostinger webmail or Gmail does not add the application's
tracking token. Tracking cannot be added retroactively to an email already sent.

## Understand the message statuses

| Status               | Meaning                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Open signal recorded | The public endpoint received one or more recorded image requests. A privacy proxy or automated system may have generated them.        |
| No signal recorded   | Tracking was enabled, but no event has synchronized. Images may be blocked, cached, or not requested. Reading status remains unknown. |
| Tracking off         | This message was sent without the application's tracking pixel.                                                                       |

Sent Emails and each prospect's conversation history show these labels. Recorded
signals include the first time, latest time and event count in the configured
business timezone. Review the recorded event categories in conversation history
for additional context. None of these labels means confirmed reading. A reply is
a separate, stronger engagement signal.

## Activate public tracking on Windows

1. Create an account at <https://dash.cloudflare.com/sign-up> and verify your
   email. A `workers.dev` address can be used for the initial test while your
   website and mailbox stay with their current providers. Review Cloudflare's
   current Workers and D1 quotas when selecting your plan.
2. On your PC, open a second PowerShell window in the main project folder.
   Run `npm.cmd run cf -- login`. Authorize Wrangler in the browser under your
   own account. Keep account credentials and tokens out of chat and GitHub.
3. Follow [Cloudflare setup](cloudflare.md) to create D1, insert its ID in
   `workers/tracking/wrangler.jsonc`, apply the remote migrations, set the shared
   secret and deploy the Worker. A D1 ID alone does not activate the endpoint.
4. Set `TRACKING_BASE_URL` to the deployed HTTPS origin and set the identical
   shared secret as `TRACKING_SYNC_SECRET` in the local ignored `.env` file.
   Preserve your existing encryption key, mailbox settings and database.
5. Stop the web process and runner with Ctrl+C, then restart using
   `npm.cmd run dev`. Settings should show Cloudflare configured; this indicates
   configuration is present, not that public tracking has passed a live test.
6. Keep normal outreach disabled. Choose a separate mailbox you control from
   the test allowlist, create a new draft and check **Include an open-signal
   pixel**. Preview and explicitly confirm the test send. Registration must
   succeed before a tracked message can be submitted.
7. Check that Sent Emails shows **SMTP Accepted** and confirm actual receipt.
   Display images in the recipient mailbox. Gmail may block images in spam;
   privacy proxies can also fetch images before you deliberately display them.
8. Keep the application and runner active with internet access. The runner
   checks tracking approximately every minute and the workspace refreshes
   approximately every 15 seconds. Check Sent Emails and conversation history
   for an open signal. Requests can be deduplicated; the count is not a count of
   confirmed human opens. A missing event remains inconclusive.
9. Reply from your test mailbox and synchronize Inbox. Verify the reply appears
   in the same conversation. Complete the remaining opt-out and recovery checks
   in the [owner-controlled verification checklist](verification.md).

The public Worker can collect events while the PC is off. The local dashboard
updates after the application and runner start again and synchronize. A working
public Worker is necessary even if the main app runs on your PC; local-only
addresses cannot receive recipient image requests over the internet.

## Gmail spam investigation

Passing SPF, DKIM and DMARC does not guarantee inbox placement. If an
owner-controlled message also lands in spam when sent directly from Hostinger
webmail, provide Hostinger support with the received message's authentication
results and Message-ID. Ask them to investigate outgoing server reputation and
delivery diagnostics. Marking a legitimate test as Not spam helps that specific
recipient account; it does not fix placement for everyone. Keep normal outreach
disabled while investigating. Tracking and spam placement are separate checks.
