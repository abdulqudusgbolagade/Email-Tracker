"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Save, Send } from "lucide-react";
import type { Snapshot } from "@/lib/data";
import { Editor } from "./editor";
import { Badge, Field, MessagePreview, Modal } from "./ui";
export type Api = <T = unknown>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
type DraftResult = { id: string; revision: number };
export function Composer({
  data,
  api,
  context,
  report,
}: {
  data: Snapshot;
  api: Api;
  context: Record<string, string>;
  report: (message: string) => void;
}) {
  const router = useRouter();
  const existing = data.drafts.find((x) => x.id === context.draft);
  const [prospectId, setProspectId] = useState(
    existing?.prospectId || context.prospect || "",
  );
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<
    Snapshot["prospects"]
  >([]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (recipientSearch)
        void api<Snapshot["prospects"]>(
          `/recipients?q=${encodeURIComponent(recipientSearch)}`,
        )
          .then((result) => {
            if (live) setRecipientResults(result);
          })
          .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, recipientSearch]);
  const recipients = [
    ...new Map(
      [...data.prospects, ...recipientResults].map((x) => [x.id, x]),
    ).values(),
  ];
  const prospect = recipients.find((x) => x.id === prospectId);
  const [campaignId, setCampaignId] = useState(
    existing?.campaignId || prospect?.campaignId || "",
  );
  const [subject, setSubject] = useState(
    existing?.subject ||
      (context.conversation
        ? "Re: Your publishing goals"
        : "A thought for {{book_title}}"),
  );
  const [html, setHtml] = useState(
    existing?.html || "<p>Hi {{first_name}},</p><p></p>",
  );
  const [text, setText] = useState(existing?.text || "Hi {{first_name}},\n\n");
  const [manualText, setManualText] = useState(Boolean(existing));
  const [tracking, setTracking] = useState(
    existing?.tracking ||
      data.campaigns.find((x) => x.id === campaignId)?.trackingDefault ||
      false,
  );
  const [draft, setDraft] = useState<DraftResult | undefined>(existing);
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
    text: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [recent, setRecent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef("");
  const recentContact = Boolean(
    prospect?.lastContacted &&
      new Date(prospect.lastContacted).getTime() >
        new Date(data.serverTime).getTime() - 7 * 86400_000,
  );
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const result = await api<DraftResult>("/drafts", "POST", {
      ...draft,
      prospectId,
      campaignId: campaignId || null,
      conversationId: existing?.conversationId || context.conversation || null,
      subject,
      html,
      text,
      tracking,
    });
    setDraft(result);
    key.current = crypto.randomUUID();
    return result;
  }
  return (
    <div className="compose-layout">
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>A personal introduction</h2>
            <p>One recipient. One considered message.</p>
          </div>
          <Badge>Individual outreach</Badge>
        </div>
        <div className="card-body">
          <Field label="Find a recipient">
            <input
              value={recipientSearch}
              onChange={(e) => setRecipientSearch(e.target.value)}
              placeholder="Search the author directory…"
            />
          </Field>
          <Field label="Recipient">
            <select
              value={prospectId}
              onChange={(e) => {
                setProspectId(e.target.value);
                setDraft(undefined);
                const p = recipients.find((x) => x.id === e.target.value);
                setCampaignId(p?.campaignId || "");
                setTracking(
                  data.campaigns.find((x) => x.id === p?.campaignId)
                    ?.trackingDefault || false,
                );
              }}
              required
            >
              <option value="">Choose a prospect</option>
              {recipients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} — {p.email}
                </option>
              ))}
            </select>
          </Field>
          {!data.prospects.length && (
            <p className="muted">
              Add a prospect before composing.{" "}
              <Link href="/prospects">Open Prospects →</Link>
            </p>
          )}
          {recentContact && (
            <div className="callout warning">
              This address was contacted within the last 7 days. Review the
              conversation to avoid duplicate outreach.
            </div>
          )}
          <Field label="Campaign">
            <select
              value={campaignId}
              onChange={(e) => {
                setCampaignId(e.target.value);
                setTracking(
                  data.campaigns.find((c) => c.id === e.target.value)
                    ?.trackingDefault || false,
                );
              }}
            >
              <option value="">Unassigned</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              required
            />
          </Field>
          <span className="field-caption">Message</span>
          <Editor
            initial={html}
            onChange={(value, plain) => {
              setHtml(value);
              if (!manualText) setText(plain);
            }}
          />
          <details className="plain-text">
            <summary>Plain-text alternative</summary>
            <Field label="Plain-text message">
              <textarea
                rows={7}
                value={text}
                onChange={(e) => {
                  setManualText(true);
                  setText(e.target.value);
                }}
              />
            </Field>
          </details>
          <p className="muted small">
            Your signature and opt-out instructions are added automatically in
            preview.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={tracking}
              onChange={(e) => setTracking(e.target.checked)}
            />
            Include an open-signal pixel
          </label>
          <p className="muted small">
            {data.trackingConfigured
              ? "Signals may come from privacy proxies or automated systems. They do not confirm reading. No signal does not mean unread."
              : "Cloudflare is not configured. Leave tracking off to send without it."}
          </p>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="form-actions">
            <button
              className="button"
              disabled={busy || !prospectId}
              onClick={() =>
                work(async () => {
                  await save();
                  report("Draft saved. No email was sent.");
                })
              }
            >
              <Save size={16} />
              Save draft
            </button>
            <button
              className="button primary"
              disabled={busy || !prospectId}
              onClick={() =>
                work(async () => {
                  const saved = await save();
                  setPreview(
                    await api("/compose/preview", "POST", {
                      draftId: saved.id,
                    }),
                  );
                  setConfirmed(false);
                  setRecent(false);
                })
              }
            >
              <Eye size={16} />
              Preview & review
            </button>
          </div>
        </div>
      </section>
      <aside className="compose-notes">
        <div className="card">
          <div className="card-body">
            <span className="eyebrow">MAKE IT PERSONAL</span>
            <h3>Start a conversation.</h3>
            <p className="muted">
              Reference their work. Explain one useful opportunity. Make the
              next step easy.
            </p>
            <hr />
            <h4>Available placeholders</h4>
            {[
              "first_name",
              "full_name",
              "book_title",
              "service_needed",
              "author_website",
              "company",
            ].map((x) => (
              <code className="placeholder-code" key={x}>{`{{${x}}}`}</code>
            ))}
            <p className="muted small">
              Missing values block sending, so placeholders never reach a
              recipient by mistake.
            </p>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <h3>Saved drafts</h3>
            {data.drafts.length ? (
              data.drafts.map((d) => (
                <Link
                  className="draft-link"
                  key={d.id}
                  href={`/compose?draft=${d.id}`}
                >
                  <strong>{d.subject}</strong>
                  <small>{d.prospect.fullName}</small>
                </Link>
              ))
            ) : (
              <p className="muted small">Your saved drafts will appear here.</p>
            )}
          </div>
        </div>
      </aside>
      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title="Review before sending"
        description={`${prospect?.fullName || ""} · ${prospect?.email || ""}`}
        wide
      >
        {preview && (
          <>
            <h3>{preview.subject}</h3>
            <MessagePreview html={preview.html} />
            <details>
              <summary>Plain-text version</summary>
              <pre className="plain-preview">{preview.text}</pre>
            </details>
            <div className="callout">
              {tracking
                ? "Open-signal tracking is enabled. Preview never requests the pixel."
                : "Open-signal tracking is disabled."}{" "}
              SMTP acceptance will not confirm recipient delivery.
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed this recipient and message and authorize sending.
            </label>
            {recentContact && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={recent}
                  onChange={(e) => setRecent(e.target.checked)}
                />
                I reviewed the recent-contact warning and still want to send.
              </label>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button className="button" onClick={() => setPreview(null)}>
                Back to editing
              </button>
              <button
                className="button primary"
                disabled={busy || !confirmed || (recentContact && !recent)}
                onClick={() =>
                  work(async () => {
                    if (!draft) return;
                    await api("/send", "POST", {
                      draftId: draft.id,
                      revision: draft.revision,
                      idempotencyKey: key.current,
                      confirmed: true,
                      recentContactConfirmed: recent,
                    });
                    router.push("/sent-emails");
                    report(
                      "Send confirmed and queued. Follow its actual outcome in Sent Emails.",
                    );
                  })
                }
              >
                <Send size={16} />
                {busy ? "Queuing…" : "Confirm & send"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
