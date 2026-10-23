"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  Send,
  SquarePen,
  Users,
  Layers,
  Clock3,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  ArrowUpRight,
  RefreshCw,
  Download,
  Upload,
  Search,
  ArrowRight,
  Eye,
  MessageSquare,
  CircleCheck,
  LogOut,
  ChevronRight,
  Mail,
  ShieldCheck,
} from "lucide-react";
import type { Snapshot, History } from "@/lib/data";
import { SERVICES } from "@/lib/validation";
import { Composer, type Api } from "./composer";
import { Settings } from "./settings";
import { Badge, Empty } from "./ui";
import { OpenSignalStatus } from "./open-signal-status";
import { CampaignForm, CsvImport, HistoryDialog, ProspectForm } from "./forms";

const navigation = [
  { slug: "overview", title: "Overview", icon: LayoutDashboard },
  { slug: "inbox", title: "Inbox", icon: Inbox },
  { slug: "sent-emails", title: "Sent Emails", icon: Send },
  { slug: "compose", title: "Compose", icon: SquarePen },
  { slug: "prospects", title: "Prospects", icon: Users },
  { slug: "campaigns", title: "Campaigns", icon: Layers },
  { slug: "follow-ups", title: "Follow-ups", icon: Clock3 },
  { slug: "analytics", title: "Analytics", icon: ChartNoAxesCombined },
  { slug: "settings", title: "Settings", icon: Settings2 },
];
const subtitles: Record<string, string> = {
  overview: "A clear view of your outreach and the conversations ahead.",
  inbox: "Keep meaningful replies moving forward.",
  "sent-emails": "Every confirmed send, with its actual outcome.",
  compose: "A thoughtful message is the start of a good relationship.",
  prospects: "The authors behind your next great collaboration.",
  campaigns: "Give every outreach effort a clear purpose.",
  "follow-ups": "The right next step, at the right time.",
  analytics: "Understand your outreach through honest, useful metrics.",
  settings: "Your mailbox, preferences and operating controls.",
};
export function Workspace({
  view,
  csrf,
  ownerEmail,
  context,
}: {
  view: string;
  csrf: string;
  ownerEmail: string;
  context: Record<string, string>;
}) {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const focus = context.prospect || "";
  const focusDraft = context.draft || "";
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [campaign, setCampaign] = useState("");
  const [service, setService] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState("");
  const [prospect, setProspect] = useState<Snapshot["prospects"][number]>();
  const [selectedCampaign, setSelectedCampaign] =
    useState<Snapshot["campaigns"][number]>();
  const [history, setHistory] = useState<History | null>(null);
  const api: Api = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        method,
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (response.status === 401) {
        router.replace("/login");
        throw new Error("Session expired. Sign in again.");
      }
      if (!response.ok) throw new Error(result.error || "Request failed.");
      return result as T;
    },
    [csrf, router],
  );
  const reload = useCallback(async () => {
    const params = new URLSearchParams({
      view,
      from,
      to,
      campaign,
      service,
      q: query,
      page: String(page),
      focus,
      draft: focusDraft,
    });
    setData(await api<Snapshot>(`/data?${params}`));
  }, [api, view, from, to, campaign, service, query, page, focus, focusDraft]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          view,
          from,
          to,
          campaign,
          service,
          q: query,
          page: String(page),
          focus,
          draft: focusDraft,
        });
        const result = await api<Snapshot>(`/data?${params}`);
        if (live) setData(result);
      } catch (e) {
        if (live)
          setError(
            e instanceof Error ? e.message : "Could not load workspace.",
          );
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, view, from, to, campaign, service, query, page, focus, focusDraft]);
  async function run(action: () => Promise<void>) {
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
  const showHistory = (id: string) =>
    run(async () => {
      setHistory(await api<History>(`/prospects/${id}`));
    });
  const title = navigation.find((x) => x.slug === view)?.title || "Overview";
  const formatDate = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: data?.settings.timezone || "Africa/Lagos",
        })
      : "—";
  const metrics = data
    ? [
        {
          title: "Emails sent",
          value: data.metrics.sent,
          icon: Send,
          note: "Accepted by SMTP · delivery unconfirmed",
        },
        {
          title: "Open signals",
          value: data.metrics.signals,
          icon: Eye,
          note: "Recorded image requests · not reads",
        },
        {
          title: "Replies received",
          value: data.metrics.replies,
          icon: MessageSquare,
          note: "Qualifying incoming replies in this period",
        },
        {
          title: "Reply rate",
          value: `${data.metrics.replyRate}%`,
          icon: ChartNoAxesCombined,
          note: "Matched replies / accepted send cohort",
        },
      ]
    : [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/overview" className="brand">
          <span className="brand-monogram">
            G<span>·</span>
          </span>
          <span>
            <strong>Grant</strong>
            <small>MAIL TRACKER</small>
          </span>
        </Link>
        <div className="workspace-label">GRANT PUBLISHING CO.</div>
        <Link href="/compose" className="button sidebar-compose">
          <Plus size={17} />
          New outreach
        </Link>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.slug}
              href={`/${item.slug}`}
              className={`nav-item ${view === item.slug ? "active" : ""}`}
              aria-current={view === item.slug ? "page" : undefined}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{item.title}</span>
              {item.slug === "follow-ups" && Boolean(data?.metrics.due) && (
                <b className="nav-count">{data!.metrics.due}</b>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={17} />
          <div>
            <strong>Private workspace</strong>
            <small>Personal outreach. Thoughtfully managed.</small>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>{title}</span>
          </div>
          <div className="owner">
            <span className="private-label">
              <span className="status-dot live" />
              Owner access
            </span>
            <span className="avatar">{ownerEmail[0].toUpperCase()}</span>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", "POST", {});
                  router.replace("/login");
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR OUTREACH WORKSPACE</span>
              <h1>
                {view === "overview" ? "Make every conversation count." : title}
              </h1>
              <p>{subtitles[view]}</p>
            </div>
            <div className="heading-actions">
              {view === "prospects" ? (
                <>
                  <button className="button" onClick={() => setModal("csv")}>
                    <Upload size={16} />
                    Import CSV
                  </button>
                  <button
                    className="button primary"
                    onClick={() => {
                      setProspect(undefined);
                      setModal("prospect");
                    }}
                  >
                    <Plus size={17} />
                    Add prospect
                  </button>
                </>
              ) : view === "campaigns" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    setSelectedCampaign(undefined);
                    setModal("campaign");
                  }}
                >
                  <Plus size={17} />
                  New campaign
                </button>
              ) : ["overview", "inbox", "sent-emails"].includes(view) ? (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await api<{ message: string }>(
                        "/sync",
                        "POST",
                        {},
                      );
                      setNotice(result.message);
                      await reload();
                    })
                  }
                >
                  <RefreshCw size={16} />
                  Sync inbox
                </button>
              ) : null}
            </div>
          </div>
          {notice && (
            <div className="notice" role="status">
              <CircleCheck size={17} />
              <span>{notice}</span>
              <button className="text-button" onClick={() => setNotice("")}>
                Dismiss
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="error callout">
              {error}
              <button className="text-button" onClick={() => run(reload)}>
                Retry
              </button>
            </div>
          )}
          {!data ? (
            <div className="card loading-state">Loading your workspace…</div>
          ) : (
            <>
              {!data.mailboxConfigured && view !== "settings" && (
                <div className="setup-banner">
                  <div className="setup-icon">
                    <Mail size={21} />
                  </div>
                  <div>
                    <strong>
                      Your workspace is ready for its first connection.
                    </strong>
                    <p>
                      Connect the authorized mailbox, then verify sending and
                      receiving with your own test address.
                    </p>
                  </div>
                  <Link href="/settings">
                    Connect mailbox <ArrowRight size={16} />
                  </Link>
                </div>
              )}
              {["overview", "analytics"].includes(view) && (
                <>
                  <div className="filter-bar">
                    <div className="filter-label">Reporting period</div>
                    <label className="date-field">
                      <span>From</span>
                      <input
                        type="date"
                        aria-label="From date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                    </label>
                    <label className="date-field">
                      <span>To</span>
                      <input
                        type="date"
                        aria-label="To date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Campaign filter"
                      value={campaign}
                      onChange={(e) => setCampaign(e.target.value)}
                    >
                      <option value="">All campaigns</option>
                      {data.campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Service filter"
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                    >
                      <option value="">All services</option>
                      {SERVICES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </div>
                  <div className="metrics-grid">
                    {metrics.map((metric) => (
                      <article className="metric-card" key={metric.title}>
                        <div>
                          <span>{metric.title}</span>
                          <metric.icon size={18} strokeWidth={1.7} />
                        </div>
                        <strong>{metric.value}</strong>
                        <small>{metric.note}</small>
                      </article>
                    ))}
                  </div>
                  <div className="secondary-metrics">
                    {[
                      ["Messages with signals", data.metrics.uniqueSignals],
                      ["Awaiting response", data.metrics.awaiting],
                      ["Follow-ups due", data.metrics.due],
                      ["Active campaigns", data.metrics.activeCampaigns],
                      ["Interested", data.metrics.interested],
                      ["Potential clients", data.metrics.potential],
                      ["Won", data.metrics.won],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <strong>{value}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {view === "overview" && (
                <>
                  <div className="overview-grid">
                    <section className="card">
                      <div className="card-heading">
                        <div>
                          <h2>Your next conversations</h2>
                          <p>Upcoming reminders, ready for your review.</p>
                        </div>
                        <Link href="/follow-ups" className="text-button">
                          View all <ArrowUpRight size={14} />
                        </Link>
                      </div>
                      {data.followups.length ? (
                        <div className="reminder-list">
                          {data.followups.slice(0, 5).map((f) => (
                            <div className="reminder-row" key={f.id}>
                              <span className="person-avatar">
                                {f.conversation.prospect.fullName[0]}
                              </span>
                              <div>
                                <button
                                  className="name-button"
                                  onClick={() =>
                                    showHistory(f.conversation.prospectId)
                                  }
                                >
                                  {f.conversation.prospect.fullName}
                                </button>
                                <small>{f.conversation.prospect.service}</small>
                              </div>
                              <time>{formatDate(f.dueAt)}</time>
                              <Link
                                href={`/compose?prospect=${f.conversation.prospectId}&conversation=${f.conversationId}`}
                                className="icon-button"
                                aria-label={`Compose follow-up for ${f.conversation.prospect.fullName}`}
                              >
                                <ArrowRight size={17} />
                              </Link>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="A clear slate for your next chapter">
                          Follow-up reminders appear here after your first
                          accepted outreach. They never send automatically.
                        </Empty>
                      )}
                    </section>
                    <section className="card getting-started">
                      <div className="card-heading">
                        <div>
                          <h2>A considered beginning</h2>
                          <p>Your path to the first conversation.</p>
                        </div>
                      </div>
                      <div className="steps">
                        {[
                          {
                            title: "Connect your mailbox",
                            note: "Verify SMTP and IMAP independently.",
                            done:
                              data.mailboxConfigured &&
                              Boolean(
                                data.settings.lastSmtpTest &&
                                  data.settings.lastImapTest,
                              ),
                            href: "/settings",
                          },
                          {
                            title: "Add your first prospect",
                            note: "Start with an address you control.",
                            done: data.prospectCount > 0,
                            href: "/prospects",
                          },
                          {
                            title: "Send a personal introduction",
                            note: "Preview, confirm and follow its outcome.",
                            done: data.metrics.sent > 0,
                            href: "/compose",
                          },
                        ].map((step, index) => (
                          <Link
                            className="step"
                            key={step.title}
                            href={step.href}
                          >
                            <span
                              className={`step-number ${step.done ? "done" : ""}`}
                            >
                              {step.done ? (
                                <CircleCheck size={17} />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <div>
                              <strong>{step.title}</strong>
                              <small>{step.note}</small>
                            </div>
                            <ChevronRight size={16} />
                          </Link>
                        ))}
                      </div>
                      <div className="signal-note">
                        <Eye size={18} />
                        <p>
                          <strong>Signals, with perspective.</strong>
                          <br />
                          An image request is an open signal. It does not
                          establish that someone read your email.
                        </p>
                      </div>
                    </section>
                  </div>
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h2>Recent outreach</h2>
                        <p>A record of your latest confirmed sends.</p>
                      </div>
                      <Link href="/sent-emails" className="text-button">
                        View sent emails <ArrowUpRight size={14} />
                      </Link>
                    </div>
                    <MessageTable
                      messages={data.messages.slice(0, 5)}
                      formatDate={formatDate}
                      timeZone={data.settings.timezone}
                      history={showHistory}
                      reconcile={(id) =>
                        run(async () => {
                          await api(`/messages/${id}/reconcile`, "POST", {});
                          setNotice(
                            "Sent reconciliation completed without resending.",
                          );
                          await reload();
                        })
                      }
                    />
                  </section>
                </>
              )}
              {["inbox", "sent-emails"].includes(view) && (
                <section className="card">
                  <div className="card-heading">
                    <h2>
                      {view === "inbox"
                        ? "Incoming conversations"
                        : "Message activity"}
                    </h2>
                    <Badge>Latest 100 messages</Badge>
                  </div>
                  <MessageTable
                    messages={data.messages}
                    formatDate={formatDate}
                    timeZone={data.settings.timezone}
                    history={showHistory}
                    reconcile={(id) =>
                      run(async () => {
                        await api(`/messages/${id}/reconcile`, "POST", {});
                        setNotice(
                          "Sent reconciliation completed. No SMTP resend was attempted.",
                        );
                        await reload();
                      })
                    }
                  />
                  {view === "sent-emails" && (
                    <div className="card-body">
                      <p className="muted small">
                        An open signal is an image request, not proof of
                        reading. No signal does not prove an email went unread.
                        Privacy proxies and automated systems can also request
                        images. Tracking applies to messages sent through this
                        app with tracking enabled; it cannot be added to earlier
                        emails.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {view === "compose" && (
                <Composer
                  key={`${context.draft || ""}:${context.prospect || ""}:${context.conversation || ""}`}
                  data={data}
                  api={api}
                  context={context}
                  report={setNotice}
                />
              )}
              {view === "prospects" && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        Author directory{" "}
                        <span className="count-label">
                          {data.prospectCount}
                        </span>
                      </h2>
                      <p>Relationships first. Every record has a history.</p>
                    </div>
                    <a
                      className="text-button"
                      href="/api/exports/prospects"
                      download
                    >
                      <Download size={15} />
                      Export CSV
                    </a>
                  </div>
                  <div className="directory-toolbar">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search prospects"
                        placeholder="Search authors, emails or books…"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(1);
                        }}
                      />
                    </label>
                    <select
                      aria-label="Prospect service filter"
                      value={service}
                      onChange={(e) => {
                        setService(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">All services</option>
                      {SERVICES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </div>
                  {data.prospects.length ? (
                    <div className="table-wrap responsive-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Author</th>
                            <th>Book / service</th>
                            <th>Status</th>
                            <th>Last contact</th>
                            <th>Next step</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.prospects.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="name-button"
                                  onClick={() => showHistory(p.id)}
                                >
                                  {p.fullName}
                                </button>
                                <small>{p.email}</small>
                              </td>
                              <td>
                                {p.bookTitle || "—"}
                                <small>{p.service}</small>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    p.status === "Do Not Contact"
                                      ? "red"
                                      : ["Interested", "Won"].includes(p.status)
                                        ? "green"
                                        : p.status === "Replied"
                                          ? "blue"
                                          : ""
                                  }
                                >
                                  {p.status}
                                </Badge>
                              </td>
                              <td data-label="Last contact">
                                {formatDate(p.lastContacted)}
                              </td>
                              <td data-label="Next step">
                                {formatDate(p.followUpDate)}
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setProspect(p);
                                      setModal("prospect");
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <Link
                                    className="icon-button"
                                    href={`/compose?prospect=${p.id}`}
                                    aria-label={`Compose for ${p.fullName}`}
                                  >
                                    <SquarePen size={16} />
                                  </Link>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title={
                        query
                          ? "No matching prospects"
                          : "Meet your next collaborator"
                      }
                    >
                      {query
                        ? "Try another name, email address or book title."
                        : "Add an author manually or import a CSV. Start with an owner-controlled address for testing."}
                    </Empty>
                  )}
                  <div className="pagination">
                    <span>
                      {data.prospectCount} records · Page {page} of{" "}
                      {Math.max(1, Math.ceil(data.prospectCount / 100))}
                    </span>
                    <button
                      className="button small-button"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="button small-button"
                      disabled={page * 100 >= data.prospectCount}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
              )}
              {view === "campaigns" &&
                (data.campaigns.length ? (
                  <div className="campaign-grid">
                    {data.campaigns.map((c) => {
                      const stats = data.metrics.byCampaign.find(
                        (x) => x.id === c.id,
                      );
                      return (
                        <article className="card" key={c.id}>
                          <div className="card-body">
                            <div className="campaign-top">
                              <span className="campaign-icon">
                                <Layers size={22} />
                              </span>
                              <Badge tone={c.active ? "green" : ""}>
                                {c.active ? "Active" : "Paused"}
                              </Badge>
                            </div>
                            <h2>{c.name}</h2>
                            <p className="muted">{c.service}</p>
                            <div className="campaign-stats">
                              <div>
                                <strong>{stats?.sent || 0}</strong>
                                <small>Sent</small>
                              </div>
                              <div>
                                <strong>{stats?.replied || 0}</strong>
                                <small>Replied messages</small>
                              </div>
                              <div>
                                <strong>{stats?.signals || 0}</strong>
                                <small>Open signals</small>
                              </div>
                            </div>
                            <div className="campaign-footer">
                              <small>
                                {stats?.conversions || 0} won · Tracking
                                default: {c.trackingDefault ? "on" : "off"}
                              </small>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setSelectedCampaign(c);
                                  setModal("campaign");
                                }}
                              >
                                Manage <ArrowRight size={14} />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <section className="card">
                    <Empty title="Give your outreach a direction">
                      Create a campaign for book publicity, formatting, cover
                      design, Amazon optimization or podcast outreach.
                    </Empty>
                  </section>
                ))}
              {view === "follow-ups" && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>Review your next steps</h2>
                      <p>
                        Due reminders first, followed by upcoming reminders.
                        Nothing sends automatically.
                      </p>
                    </div>
                    <Badge>{data.metrics.due} due</Badge>
                  </div>
                  {data.followups.length ? (
                    <div className="followup-list">
                      {data.followups.map((f) => (
                        <article className="followup-row" key={f.id}>
                          <div>
                            <div className="followup-title">
                              <button
                                className="name-button"
                                onClick={() =>
                                  showHistory(f.conversation.prospectId)
                                }
                              >
                                {f.conversation.prospect.fullName}
                              </button>
                              <Badge
                                tone={
                                  new Date(f.dueAt) <= new Date(data.serverTime)
                                    ? "amber"
                                    : ""
                                }
                              >
                                {new Date(f.dueAt) <= new Date(data.serverTime)
                                  ? "Due"
                                  : "Upcoming"}
                              </Badge>
                            </div>
                            <p>{f.conversation.subject}</p>
                            <small>
                              Follow-up {f.step + 1} · {formatDate(f.dueAt)} ·{" "}
                              {f.conversation.prospect.service}
                            </small>
                          </div>
                          <div className="followup-actions">
                            <button
                              className="button small-button"
                              onClick={() =>
                                showHistory(f.conversation.prospectId)
                              }
                            >
                              Review conversation
                            </button>
                            <Link
                              className="button primary small-button"
                              href={`/compose?prospect=${f.conversation.prospectId}&conversation=${f.conversationId}`}
                            >
                              Compose follow-up
                            </Link>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                const date = window.prompt(
                                  "Snooze until (YYYY-MM-DD, business timezone at 09:00):",
                                );
                                if (date)
                                  void run(async () => {
                                    await api(`/followups/${f.id}`, "POST", {
                                      action: "snooze",
                                      date,
                                    });
                                    await reload();
                                  });
                              }}
                            >
                              Snooze
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api(`/followups/${f.id}`, "POST", {
                                    action: "complete",
                                  });
                                  await reload();
                                })
                              }
                            >
                              Mark completed
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api(`/followups/${f.id}`, "POST", {
                                    action: "not-interested",
                                  });
                                  await reload();
                                })
                              }
                            >
                              Not interested
                            </button>
                            <button
                              className="text-button danger"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Stop contact and cancel all pending reminders for this prospect?",
                                  )
                                )
                                  void run(async () => {
                                    await api(`/followups/${f.id}`, "POST", {
                                      action: "stop",
                                    });
                                    await reload();
                                  });
                              }}
                            >
                              Stop contact
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty title="Nothing waiting on your follow-up list">
                      Accepted outreach creates configurable reminders.
                      Qualifying replies cancel them unless you choose
                      otherwise.
                    </Empty>
                  )}
                </section>
              )}
              {view === "analytics" && (
                <>
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h2>Campaign performance</h2>
                        <p>Results for the selected accepted-send cohort.</p>
                      </div>
                    </div>
                    {data.metrics.byCampaign.length ? (
                      <div className="table-wrap responsive-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Campaign</th>
                              <th>SMTP accepted</th>
                              <th>Replied messages</th>
                              <th>Reply rate</th>
                              <th>Recorded signals</th>
                              <th>Conversions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.metrics.byCampaign.map((c) => (
                              <tr key={c.id}>
                                <td>
                                  {data.campaigns.find((x) => x.id === c.id)
                                    ?.name || "Unassigned"}
                                </td>
                                <td>{c.sent}</td>
                                <td>{c.replied}</td>
                                <td>
                                  {c.sent
                                    ? Math.round((c.replied / c.sent) * 1000) /
                                      10
                                    : 0}
                                  %
                                </td>
                                <td>{c.signals}</td>
                                <td>{c.conversions}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="Your results start with a conversation">
                        Campaign statistics appear after accepted sends. There
                        is no sample activity in these metrics.
                      </Empty>
                    )}
                  </section>
                  <div className="callout">
                    <strong>How to interpret these numbers</strong>
                    <p>
                      Reply rate uses accepted outbound messages in the selected
                      period and their qualifying matched replies.
                      Received-reply and raw-signal counts use event dates.
                      Pipeline counts reflect current prospect status. Potential
                      clients are Interested, Meeting Scheduled or Proposal
                      Sent. Raw signals are retained for 90 days; per-message
                      totals can cover a longer period.
                    </p>
                  </div>
                </>
              )}
              {view === "settings" && (
                <>
                  <Settings
                    data={data}
                    api={api}
                    reload={reload}
                    report={setNotice}
                  />
                  <section className="card">
                    <div className="card-heading">
                      <h2>Recent audit activity</h2>
                      <Badge>Latest 50 entries</Badge>
                    </div>
                    {data.audit.length ? (
                      <div className="audit-list">
                        {data.audit.map((a) => (
                          <div key={a.id}>
                            <strong>{a.action}</strong>
                            <span>{a.detail}</span>
                            <time>
                              {new Date(a.createdAt).toLocaleString("en", {
                                timeZone: data.settings.timezone,
                              })}
                            </time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="No audit activity yet">
                        Confirmed sends and important record changes are
                        recorded here.
                      </Empty>
                    )}
                  </section>
                </>
              )}
              <footer className="workspace-footer">
                <span>
                  Grant Publishing Co. <span className="footer-dot">·</span>{" "}
                  Thoughtful outreach, organized.
                </span>
                <span>Open signals are not confirmed reads.</span>
              </footer>
              {modal === "prospect" && (
                <ProspectForm
                  key={prospect?.id || "new"}
                  prospect={prospect}
                  data={data}
                  api={api}
                  onDone={reload}
                  onClose={() => setModal("")}
                />
              )}
              {modal === "campaign" && (
                <CampaignForm
                  key={selectedCampaign?.id || "new"}
                  campaign={selectedCampaign}
                  api={api}
                  onDone={reload}
                  onClose={() => setModal("")}
                />
              )}
              {modal === "csv" && (
                <CsvImport
                  api={api}
                  onDone={reload}
                  onClose={() => setModal("")}
                />
              )}
              {history && (
                <HistoryDialog
                  history={history}
                  timeZone={data.settings.timezone}
                  api={api}
                  onDone={reload}
                  onClose={() => setHistory(null)}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function MessageTable({
  messages,
  formatDate,
  timeZone,
  history,
  reconcile,
}: {
  messages: Snapshot["messages"];
  formatDate: (value: string | null) => string;
  timeZone: string;
  history: (id: string) => void;
  reconcile: (id: string) => void;
}) {
  if (!messages.length)
    return (
      <Empty title="The next conversation starts with you">
        Messages and replies will appear here as real outreach is sent and
        synchronized.
      </Empty>
    );
  return (
    <div className="table-wrap responsive-table">
      <table>
        <thead>
          <tr>
            <th>Prospect / subject</th>
            <th>Status</th>
            <th>Open signals</th>
            <th>Date</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id}>
              <td>
                <button
                  className="name-button"
                  onClick={() => history(m.conversation.prospect.id)}
                >
                  {m.conversation.prospect.fullName}
                </button>
                <small className="message-subject">{m.subject}</small>
                {m.attempts[0]?.error && (
                  <small className="error">{m.attempts[0].error}</small>
                )}
              </td>
              <td>
                <Badge
                  tone={
                    m.state === "SMTP Accepted" || m.qualifiedReply
                      ? "green"
                      : m.state === "Outcome Unknown" || m.bounce
                        ? "amber"
                        : m.state === "Rejected"
                          ? "red"
                          : ""
                  }
                >
                  {m.bounce
                    ? "Failure notice"
                    : m.qualifiedReply
                      ? "Reply received"
                      : m.state}
                </Badge>
                {m.direction === "Outbound" && (
                  <>
                    <small>{m.delivery}</small>
                    <small>
                      {m.sentCopySaved
                        ? "Sent copy saved"
                        : `Sent copy: ${m.sentCopyState.toLowerCase()}`}
                    </small>
                  </>
                )}
                {m.automated && <small>Automated / notice</small>}
              </td>
              <td>
                {m.direction === "Outbound" ? (
                  <OpenSignalStatus message={m} timeZone={timeZone} />
                ) : (
                  "—"
                )}
              </td>
              <td>{formatDate(m.receivedAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="text-button"
                    onClick={() => history(m.conversation.prospect.id)}
                  >
                    Review <ArrowUpRight size={14} />
                  </button>
                  {m.direction === "Outbound" &&
                    ["SMTP Accepted", "Outcome Unknown"].includes(m.state) &&
                    !m.sentCopySaved && (
                      <button
                        className="text-button"
                        onClick={() => reconcile(m.id)}
                      >
                        Reconcile Sent
                      </button>
                    )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
