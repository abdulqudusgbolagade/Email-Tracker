import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { session, SESSION_COOKIE } from "@/lib/auth";
import { csrfFor, safeError } from "@/lib/security";
import { oauthConsentDetails, oauthGuard } from "@/lib/mcp-oauth";
import { OAuthConsent } from "@/components/mcp-consent";
export const dynamic = "force-dynamic";
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const id = typeof params.request === "string" ? params.request : "";
  let details;
  try {
    const host = (await headers()).get("host") || "";
    oauthGuard(
      new Request(`http://${host || "invalid"}/mcp/authorize`, {
        headers: { host },
      }),
    );
    details = await oauthConsentDetails(id);
  } catch (error) {
    return (
      <main className="oauth-page">
        <section className="card oauth-card">
          <div className="card-body">
            <h1>Connection unavailable</h1>
            <p role="alert">{safeError(error)}</p>
            <Link className="button" href="/settings">
              Return to Settings
            </Link>
          </div>
        </section>
      </main>
    );
  }
  const raw = (await cookies()).get(SESSION_COOKIE)?.value || "";
  const user = await session(raw);
  if (!user)
    redirect(
      `/login?${new URLSearchParams({ next: `/mcp/authorize?request=${id}` })}`,
    );
  return (
    <main className="oauth-page">
      <section className="card oauth-card">
        <div className="card-body">
          <span className="eyebrow">
            GRANT MAIL TRACKER · PRIVATE WORKSPACE
          </span>
          <h1>Connect your outreach tools</h1>
          <p>
            <strong>{details.name}</strong> is requesting access as{" "}
            <strong>{user.owner.email}</strong>.
          </p>
          <p className="muted small">
            Client callback: {details.callbackOrigin}. The client name is
            supplied by the client; approve only a connection you started.
          </p>
          <ul>
            <li>Find and add prospects.</li>
            <li>Prepare outreach drafts for your review.</li>
            <li>Check sending outcomes, replies and open signals.</li>
          </ul>
          <p>
            Every email still needs your confirmation in Grant Mail Tracker.
            Mailbox passwords and account settings are never shared with this
            connection.
          </p>
          <p className="muted small">
            Access expires after 30 days and can be revoked in Settings. Open
            signals do not confirm reading.
          </p>
          <OAuthConsent requestId={id} csrf={csrfFor(raw)} />
        </div>
      </section>
    </main>
  );
}
