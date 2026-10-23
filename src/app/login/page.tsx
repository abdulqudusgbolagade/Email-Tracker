import { db } from "@/lib/db";
import { LoginForm } from "@/components/login";
import { reviewReturn } from "@/lib/review-link";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const configured = (await db.owner.count()) > 0;
  const returnTo = reviewReturn((await searchParams).next);
  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark">
          G<span>·</span>
        </div>
        <span className="eyebrow">GRANT PUBLISHING CO.</span>
        <h1>
          Good conversations.
          <br />
          Great possibilities.
        </h1>
        <p>
          A considered approach to author outreach. Keep your prospects,
          conversations and next steps in one private workspace.
        </p>
        <div className="login-foot">
          GRANT MAIL TRACKER <span>PRIVATE WORKSPACE</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Your next chapter starts here.</h2>
          <p className="muted">Sign in to your outreach workspace.</p>
          {configured ? (
            <LoginForm returnTo={returnTo} />
          ) : (
            <div className="callout">
              <strong>Provision the owner account first</strong>
              <p>
                Run <code>npm run setup</code> in an interactive terminal. The
                password prompt is hidden. There are no default credentials.
              </p>
            </div>
          )}
          <p className="login-security">
            Private access · Secure sessions · Your mailbox stays yours
          </p>
        </div>
      </section>
    </main>
  );
}
