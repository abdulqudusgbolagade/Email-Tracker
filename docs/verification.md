# Owner-controlled email acceptance test

Automated tests use fixture addresses under `.test`, a local SMTP sink and isolated databases. They do not prove live provider access. Perform this checklist with mailboxes you own and keep normal outreach disabled until it passes.

1. Provision your owner account. In Settings enter your authorized Hostinger mailbox securely, save, then test SMTP and IMAP independently. Verify the mailbox settings against your actual Hostinger mail product.
2. Add a separate mailbox you control to test recipients. Create a prospect for it with a nonempty book title and a small test campaign.
3. Compose a short personal message with tracking off. Check HTML and plain-text previews, signature and opt-out footer. Confirm once. Clicking again or retrying the same request must not create another operation.
4. Keep the runner active. In Sent Emails verify SMTP Accepted, recipient delivery Unconfirmed and Sent-copy status. Independently inspect receipt in your controlled inbox and the sender's Sent folder. Match the Message-ID and verify no duplicate copy.
5. Reply from that controlled address. Use Sync inbox. Verify the same prospect/conversation receives the reply, reply count changes and pending reminders are cancelled. An automatic vacation response should not count as a qualifying human reply.
6. For a reminder test, send another explicitly confirmed follow-up and verify its configured due date. Snooze and complete it manually. Stop contact must block further queued and new sends.
7. Deploy the Worker and D1 using the Cloudflare guide. Set the public HTTPS origin and matching shared key locally; restart both processes. Send another controlled message with tracking enabled.
8. Before displaying remote images, check the original message source contains one unpredictable `/p/<token>.gif` URL with no address or name. Local preview and Sent display must not request that URL.
9. Display images in the recipient mailbox or request that owned message's pixel once for a controlled endpoint test. Synchronize and verify the first/latest recorded signal and event count. Repeated requests in the same minute/category can be deduplicated. Do not interpret the signal as proof of reading.
10. Open the unsubscribe link: GET alone must not suppress. Confirm the POST, then verify synchronization marks Do Not Contact and cancels reminders. Subsequent sends must be blocked. Test a reply whose first line is exactly “unsubscribe” without relying on a public link.
11. Temporarily make the Worker unavailable after public opt-out links exist. A confirmed send must remain queued and show an actionable synchronization error without contacting SMTP. Restore service and verify recovery.
12. Export CSV and take a SQLite backup. Restore a copy in an isolated directory with the matching encryption key; verify records, history and suppression before using it as a recovery source.

Record provider tests as passed, failed or unrun, including date, mail product and controlled addresses in your private records. Do not put passwords, full capability URLs, message bodies or API secrets in screenshots or public issue reports.
