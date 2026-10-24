import { oauthRoute } from "@/lib/mcp-oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!["register", "authorize", "token", "revoke", "consent"].includes(action))
    return new Response(null, { status: 404 });
  return oauthRoute(
    request,
    action as "register" | "authorize" | "token" | "revoke" | "consent",
  );
}
export {
  handler as GET,
  handler as POST,
  handler as DELETE,
  handler as OPTIONS,
};
