"use client";
import { useState } from "react";
import Link from "next/link";
import type { Snapshot, History } from "@/lib/data";
import { SERVICES, STATUSES } from "@/lib/validation";
import type { Api } from "./composer";
import { Badge, Empty, Field, MessagePreview, Modal } from "./ui";
type Prospect = Snapshot["prospects"][number];
type Campaign = Snapshot["campaigns"][number];
export function ProspectForm({
  prospect,
  data,
  api,
  onDone,
  onClose,
}: {
  prospect?: Prospect;
  data: Snapshot;
  api: Api;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={prospect ? "Edit prospect" : "Add a prospect"}
      description="A complete author record, ready for a personal conversation."
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(event.currentTarget);
          try {
            await api(
              `/prospects${prospect ? `/${prospect.id}` : ""}`,
              prospect ? "PUT" : "POST",
              {
                ...Object.fromEntries(form),
                campaignId: form.get("campaignId") || null,
              },
            );
            await onDone();
            onClose();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not save prospect.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Full name">
            <input
              name="fullName"
              defaultValue={prospect?.fullName}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Email address">
            <input
              name="email"
              type="email"
              defaultValue={prospect?.email}
              required
              maxLength={254}
            />
          </Field>
          <Field label="Author website">
            <input
              name="website"
              type="url"
              placeholder="https://"
              defaultValue={prospect?.website}
            />
          </Field>
          <Field label="Book title">
            <input name="bookTitle" defaultValue={prospect?.bookTitle} />
          </Field>
          <Field label="Book genre">
            <input name="bookGenre" defaultValue={prospect?.bookGenre} />
          </Field>
          <Field label="Country">
            <input name="country" defaultValue={prospect?.country} />
          </Field>
          <Field label="Publishing platform">
            <input
              name="publishingPlatform"
              defaultValue={prospect?.publishingPlatform}
            />
          </Field>
          <Field label="Lead source">
            <input name="leadSource" defaultValue={prospect?.leadSource} />
          </Field>
          <Field label="Service needed">
            <select
              name="service"
              defaultValue={prospect?.service || SERVICES[0]}
            >
              {SERVICES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Campaign">
            <select name="campaignId" defaultValue={prospect?.campaignId || ""}>
              <option value="">Unassigned</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prospect status">
            <select name="status" defaultValue={prospect?.status || "New"}>
              {STATUSES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            name="notes"
            defaultValue={prospect?.notes}
            rows={4}
            maxLength={20000}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save prospect"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function CampaignForm({
  campaign,
  api,
  onDone,
  onClose,
}: {
  campaign?: Campaign;
  api: Api;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={campaign ? "Edit campaign" : "Create a campaign"}
      description="Organize individual outreach. Creating a campaign never sends email."
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            await api(
              `/campaigns${campaign ? `/${campaign.id}` : ""}`,
              campaign ? "PUT" : "POST",
              {
                name: form.get("name"),
                service: form.get("service"),
                active: form.has("active"),
                trackingDefault: form.has("trackingDefault"),
              },
            );
            await onDone();
            onClose();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not save campaign.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Campaign name">
          <input
            name="name"
            defaultValue={campaign?.name}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Service category">
          <select
            name="service"
            defaultValue={campaign?.service || SERVICES[0]}
          >
            {SERVICES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={campaign?.active ?? true}
          />
          Active campaign
        </label>
        <label className="check">
          <input
            name="trackingDefault"
            type="checkbox"
            defaultChecked={campaign?.trackingDefault ?? false}
          />
          Default new messages to open-signal tracking
        </label>
        <p className="muted small">
          Individual messages can override this setting. Tracking requires a
          configured Cloudflare Worker.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            Save campaign
          </button>
        </div>
      </form>
    </Modal>
  );
}
type CsvRow = {
  row: number;
  data: { fullName: string; email: string } | null;
  errors: string[];
  existing: boolean;
};
export function CsvImport({
  api,
  onDone,
  onClose,
}: {
  api: Api;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<CsvRow[] | null>(null);
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Import prospects"
      description="Preview every row before making changes. Maximum 5,000 rows and 2 MB."
      open
      onClose={onClose}
      wide
    >
      <Field
        label="CSV file"
        hint="Required headers: fullName,email. Optional fields use the same names as the exported CSV."
      >
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setPreview(null);
            setResult("");
            if (file) {
              if (file.size > 2_000_000) setError("File exceeds 2 MB.");
              else void file.text().then(setContent);
            }
          }}
        />
      </Field>
      <button
        className="button"
        disabled={busy || !content}
        onClick={() =>
          run(async () =>
            setPreview(
              await api<CsvRow[]>("/csv/preview", "POST", { content }),
            ),
          )
        }
      >
        Validate & preview
      </button>
      {preview && (
        <>
          <p className="muted">
            {preview.length} rows ·{" "}
            {preview.filter((x) => x.errors.length).length} with errors ·{" "}
            {preview.filter((x) => x.existing).length} existing addresses
          </p>
          <div className="table-wrap limited">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Prospect</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>
                      {row.data?.fullName}
                      <small>{row.data?.email}</small>
                    </td>
                    <td>
                      {row.errors.length ? (
                        <span className="error">{row.errors.join(" ")}</span>
                      ) : (
                        <Badge tone={row.existing ? "" : "green"}>
                          {row.existing
                            ? "Existing · skipped by default"
                            : "Ready"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={update}
              onChange={(e) => setUpdate(e.target.checked)}
            />
            Update existing prospects using the values in this CSV
          </label>
          <button
            className="button primary"
            disabled={
              busy ||
              !preview.length ||
              preview.some((x) => x.errors.length > 0) ||
              Boolean(result)
            }
            onClick={() =>
              run(async () => {
                const value = await api<{
                  created: number;
                  updated: number;
                  skipped: number;
                }>("/csv/import", "POST", { content, updateExisting: update });
                setResult(
                  `${value.created} created, ${value.updated} updated, ${value.skipped} skipped.`,
                );
                await onDone();
              })
            }
          >
            Confirm import
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="callout success" role="status">
          {result}
        </div>
      )}
    </Modal>
  );
}
export function HistoryDialog({
  history,
  onClose,
  api,
  onDone,
}: {
  history: History;
  onClose: () => void;
  api: Api;
  onDone: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const p = history.prospect;
  return (
    <Modal
      title={p.fullName}
      description={`${p.email} · ${p.status}`}
      open
      onClose={onClose}
      wide
    >
      <div className="history-meta">
        <Badge>{p.service}</Badge>
        {p.bookTitle && <span>{p.bookTitle}</span>}
        <Link
          className="button small-button"
          href={`/compose?prospect=${p.id}`}
        >
          Compose email
        </Link>
      </div>
      {p.notes && (
        <div className="callout">
          <strong>Notes</strong>
          <p className="preserve-lines">{p.notes}</p>
        </div>
      )}
      {history.conversations.length ? (
        history.conversations.map((conversation) => (
          <section className="conversation" key={conversation.id}>
            <div className="section-heading">
              <h3>{conversation.subject}</h3>
              <Link
                href={`/compose?prospect=${p.id}&conversation=${conversation.id}`}
                className="text-button"
              >
                Compose follow-up →
              </Link>
            </div>
            {conversation.messages.map((message) => (
              <article className="history-message" key={message.id}>
                <div className="message-heading">
                  <Badge tone={message.direction === "Inbound" ? "blue" : ""}>
                    {message.direction === "Inbound"
                      ? "Incoming"
                      : message.state}
                  </Badge>
                  <time>{new Date(message.receivedAt).toLocaleString()}</time>
                </div>
                <h4>{message.subject}</h4>
                {message.html ? (
                  <MessagePreview
                    html={message.html}
                    title={`Message: ${message.subject}`}
                  />
                ) : (
                  <pre className="plain-preview">{message.text}</pre>
                )}
                {message.direction === "Outbound" && (
                  <p className="muted small">
                    {message.signalCount} recorded open signals · First:{" "}
                    {message.firstSignal
                      ? new Date(message.firstSignal).toLocaleString()
                      : "—"}{" "}
                    · Latest:{" "}
                    {message.latestSignal
                      ? new Date(message.latestSignal).toLocaleString()
                      : "—"}
                  </p>
                )}
                {message.automated && (
                  <Badge>Automated response or notice</Badge>
                )}
                <details>
                  <summary>Message headers & recorded signals</summary>
                  <p className="small break-all">
                    Message-ID: {message.messageId}
                    <br />
                    In-Reply-To: {message.inReplyTo || "—"}
                    <br />
                    References: {message.references}
                  </p>
                  {message.events.map((e) => (
                    <p className="small muted" key={e.id}>
                      {new Date(e.occurredAt).toLocaleString()} · {e.category}
                    </p>
                  ))}
                </details>
              </article>
            ))}
          </section>
        ))
      ) : (
        <Empty title="No conversations yet">
          Your first confirmed outreach will start this author’s history.
        </Empty>
      )}
      <details className="callout">
        <summary>Record activity ({history.activity.length})</summary>
        {history.activity.map((item) => (
          <p key={item.id}>
            <strong>{item.action}</strong> ·{" "}
            {new Date(item.createdAt).toLocaleString()}
            <br />
            {item.detail}
          </p>
        ))}
      </details>
      <div className="danger-zone">
        <p className="muted small">
          Erasing this record deletes its conversations and remote tracking
          events. Minimal suppression is retained to prevent accidental
          recontact.
        </p>
        <button
          className="text-button danger"
          onClick={async () => {
            if (
              !window.confirm(
                `Permanently erase ${p.fullName} and their conversations?`,
              )
            )
              return;
            try {
              await api(`/prospects/${p.id}`, "DELETE", { confirmed: true });
              await onDone();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Erasure failed.");
            }
          }}
        >
          Erase prospect & history
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
