import { oauthRoute } from "@/lib/mcp-oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const path = (await params).path?.join("/") || "";
  if (path && path !== "api/mcp") return new Response(null, { status: 404 });
  return oauthRoute(request, "resource");
}
export const OPTIONS = GET;
