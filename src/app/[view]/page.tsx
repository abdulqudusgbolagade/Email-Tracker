import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { session, SESSION_COOKIE } from "@/lib/auth";
import { csrfFor } from "@/lib/security";
import { Workspace } from "@/components/workspace";
export const dynamic = "force-dynamic";
const views = [
  "overview",
  "inbox",
  "sent-emails",
  "compose",
  "prospects",
  "campaigns",
  "follow-ups",
  "analytics",
  "settings",
];
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { view } = await params;
  if (!views.includes(view)) notFound();
  const raw = (await cookies()).get(SESSION_COOKIE)?.value || "";
  const owner = await session(raw);
  if (!owner) redirect("/login");
  const search = await searchParams;
  const context = Object.fromEntries(
    Object.entries(search).filter(
      (x): x is [string, string] => typeof x[1] === "string",
    ),
  );
  return (
    <Workspace
      view={view}
      csrf={csrfFor(raw)}
      ownerEmail={owner.owner.email}
      context={context}
    />
  );
}
