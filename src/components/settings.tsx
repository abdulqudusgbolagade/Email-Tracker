"use client";
import { useState } from "react";
import { CheckCircle2, ShieldCheck, Server, RefreshCw } from "lucide-react";
import type { Snapshot } from "@/lib/data";
import type { Api } from "./composer";
import { Badge, Field } from "./ui";
export function Settings({
  data,
  api,
  reload,
  report,
}: {
  data: Snapshot;
  api: Api;
  reload: () => Promise<void>;
  report: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settings = data.settings;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const element = event.currentTarget;
            void run(async () => {
              await api("/settings", "PUT", {
                timezone: form.get("timezone"),
                signature: form.get("signature"),
                intervals: form.get("intervals"),
                keepReminders: form.has("keepReminders"),
                outreachEnabled: form.has("outreachEnabled"),
                testRecipients: form.get("testRecipients"),
                hourlyLimit: Number(form.get("hourlyLimit")),
                dailyLimit: Number(form.get("dailyLimit")),
                requestLimit: Number(form.get("requestLimit")),
                fromName: form.get("fromName"),
                mailboxUser: form.get("mailboxUser"),
                password: form.get("password"),
                smtpHost: form.get("smtpHost"),
                smtpPort: Number(form.get("smtpPort")),
                smtpSecurity: form.get("smtpSecurity"),
                imapHost: form.get("imapHost"),
                imapPort: Number(form.get("imapPort")),
                sentFolder: form.get("sentFolder") || null,
              });
              (
                element.elements.namedItem("password") as HTMLInputElement
              ).value = "";
              report(
                "Settings saved. Mailbox tests can now be run independently.",
              );
            });
          }}
        >
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Connected mailbox</h2>
                <p>Your authorized Hostinger account.</p>
              </div>
              <Badge tone={data.mailboxConfigured ? "green" : ""}>
                {data.mailboxConfigured
                  ? "Credentials configured"
                  : "Setup required"}
              </Badge>
            </div>
            <div className="card-body">
              <div className="form-grid">
                <Field label="Sender name">
                  <input
                    name="fromName"
                    defaultValue={settings.fromName}
                    required
                  />
                </Field>
                <Field label="Mailbox address">
                  <input
                    name="mailboxUser"
                    type="email"
                    defaultValue={settings.mailboxUser}
                    required
                  />
                </Field>
              </div>
              <Field
                label="Mailbox password"
                hint={
                  data.environmentMailbox
                    ? "Environment credentials override these stored settings. Update the local environment to change them."
                    : "Leave blank to retain the saved password. It is encrypted on the server and never returned to this form."
                }
              >
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    data.mailboxConfigured
                      ? "•••••••• (configured; value not loaded)"
                      : "Enter securely"
                  }
                />
              </Field>
              <h3 className="subheading">SMTP · Sending</h3>
              <div className="form-grid three">
                <Field label="SMTP host">
                  <input
                    name="smtpHost"
                    defaultValue={settings.smtpHost}
                    required
                  />
                </Field>
                <Field label="SMTP port">
                  <input
                    name="smtpPort"
                    type="number"
                    min={1}
                    max={65535}
                    defaultValue={settings.smtpPort}
                    required
                  />
                </Field>
                <Field label="SMTP security">
                  <select
                    name="smtpSecurity"
                    defaultValue={settings.smtpSecurity}
                  >
                    <option value="TLS">Implicit TLS (465)</option>
                    <option value="STARTTLS">STARTTLS (587)</option>
                  </select>
                </Field>
              </div>
              <h3 className="subheading">IMAP · Receiving</h3>
              <div className="form-grid">
                <Field label="IMAP host">
                  <input
                    name="imapHost"
                    defaultValue={settings.imapHost}
                    required
                  />
                </Field>
                <Field label="IMAP port">
                  <input
                    name="imapPort"
                    type="number"
                    min={1}
                    max={65535}
                    defaultValue={settings.imapPort}
                    required
                  />
                </Field>
              </div>
              <Field
                label="Sent folder override"
                hint="Leave blank for IMAP special-use discovery. Folder names depend on your mail product."
              >
                <input
                  name="sentFolder"
                  defaultValue={settings.sentFolder || ""}
                  placeholder="Auto-detect"
                />
              </Field>
              <p className="muted small">
                TLS verification stays enabled. Save changes before running
                connection tests.
              </p>
            </div>
          </section>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Outreach & follow-ups</h2>
                <p>Set a careful, consistent pace.</p>
              </div>
            </div>
            <div className="card-body">
              <Field label="Business timezone">
                <input
                  name="timezone"
                  defaultValue={settings.timezone}
                  required
                />
              </Field>
              <Field label="Signature">
                <textarea
                  name="signature"
                  rows={3}
                  defaultValue={settings.signature}
                />
              </Field>
              <Field
                label="Follow-up intervals (calendar days)"
                hint="4,7,10 means four days after initial outreach, then seven and ten days after accepted follow-ups. Reminders are due at 09:00."
              >
                <input
                  name="intervals"
                  defaultValue={settings.intervals}
                  required
                />
              </Field>
              <label className="check">
                <input
                  name="keepReminders"
                  type="checkbox"
                  defaultChecked={settings.keepReminders}
                />
                Keep reminders after a qualifying human reply
              </label>
              <hr />
              <Field
                label="Owner-controlled test recipients"
                hint="Comma-separated addresses. Test mode blocks every address outside this list."
              >
                <textarea
                  name="testRecipients"
                  rows={2}
                  defaultValue={settings.testRecipients}
                  placeholder="your-test-mailbox@example.com"
                />
              </Field>
              <label className="check">
                <input
                  name="outreachEnabled"
                  type="checkbox"
                  defaultChecked={settings.outreachEnabled}
                />
                Enable normal outreach beyond the test allowlist
              </label>
              <p className="muted small">
                Enable only after owner-controlled sending and receiving tests
                pass. Every message still requires confirmation.
              </p>
              <div className="form-grid three">
                <Field label="Hourly send limit">
                  <input
                    name="hourlyLimit"
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={settings.hourlyLimit}
                    required
                  />
                </Field>
                <Field label="Daily send limit">
                  <input
                    name="dailyLimit"
                    type="number"
                    min={1}
                    max={5000}
                    defaultValue={settings.dailyLimit}
                    required
                  />
                </Field>
                <Field label="Requests per minute">
                  <input
                    name="requestLimit"
                    type="number"
                    min={30}
                    max={1000}
                    defaultValue={settings.requestLimit}
                    required
                  />
                </Field>
              </div>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? "Working…" : "Save settings"}
              </button>
            </div>
          </section>
        </form>
      </div>
      <aside>
        <section className="card">
          <div className="card-heading">
            <h2>Connection checks</h2>
            <ShieldCheck size={20} />
          </div>
          <div className="card-body">
            <p className="muted small">
              SMTP verification confirms authentication, not delivery. IMAP is
              checked separately.
            </p>
            {(["smtp", "imap"] as const).map((kind) => (
              <div className="connection-check" key={kind}>
                <div>
                  <strong>{kind.toUpperCase()}</strong>
                  <small>
                    {settings[kind === "smtp" ? "lastSmtpTest" : "lastImapTest"]
                      ? "Last connection test passed"
                      : "Not verified"}
                  </small>
                </div>
                <button
                  className="button small-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await api<{ message: string }>(
                        "/mailbox/test",
                        "POST",
                        { kind },
                      );
                      report(result.message);
                    })
                  }
                >
                  Test {kind.toUpperCase()}
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <h2>Background services</h2>
            <Server size={20} />
          </div>
          <div className="card-body">
            {["runner", "imap", "tracking", "sent-copy"].map((id) => {
              const job = data.jobs.find((x) => x.id === id);
              const active =
                job?.heartbeat &&
                new Date(job.heartbeat).getTime() >
                  new Date(data.serverTime).getTime() - 90000;
              return (
                <div className="health-row" key={id}>
                  <div>
                    <strong>
                      {id === "runner"
                        ? "Job runner"
                        : id === "imap"
                          ? "Inbox synchronization"
                          : id === "tracking"
                            ? "Tracking synchronization"
                            : "Sent-folder preservation"}
                    </strong>
                    <small>
                      {job?.lastRun
                        ? new Date(job.lastRun).toLocaleString("en", {
                            timeZone: settings.timezone,
                          })
                        : "No completed run"}
                    </small>
                    {job?.error && <p className="error small">{job.error}</p>}
                  </div>
                  <span
                    className={`status-dot ${active ? "live" : ""}`}
                    aria-label={
                      active ? "Heartbeat recent" : "No recent heartbeat"
                    }
                  />
                </div>
              );
            })}
            <button
              className="button full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ message: string }>("/sync", "POST", {});
                  report(r.message);
                })
              }
            >
              <RefreshCw size={15} />
              Sync inbox
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Import older Inbox history? Known-prospect messages will be matched without using subject alone.",
                  )
                )
                  void run(async () => {
                    await api("/sync", "POST", { history: true });
                    report("Older-history synchronization requested.");
                  });
              }}
            >
              Import older inbox history
            </button>
          </div>
        </section>
        <section className="card">
          <div className="card-body">
            <span className="eyebrow">PUBLIC SIGNAL ENDPOINT</span>
            <h3>Cloudflare tracking</h3>
            <Badge tone={data.trackingConfigured ? "green" : ""}>
              {data.trackingConfigured
                ? "Configured · verify with a test email"
                : "Not configured"}
            </Badge>
            <p className="muted small">
              Set TRACKING_BASE_URL and TRACKING_SYNC_SECRET in your local
              environment. Deploy the Worker and D1 migrations using the
              Cloudflare guide. Tracking stays off by default.
            </p>
            <p className="muted small">
              Pixels indicate image requests. Privacy proxies and automation can
              produce signals without a person reading.
            </p>
          </div>
        </section>
        <section className="card">
          <div className="card-body">
            <CheckCircle2 size={20} />
            <h3>Keep a recoverable copy</h3>
            <p className="muted small">
              Run <code>npm run backup</code> for a consistent SQLite backup.
              Protect the encryption key separately. CSV exports omit
              credentials.
            </p>
            <a className="button full" href="/api/exports/prospects" download>
              Export prospects CSV
            </a>
          </div>
        </section>
      </aside>
    </div>
  );
}
