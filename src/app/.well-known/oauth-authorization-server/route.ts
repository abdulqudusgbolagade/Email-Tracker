import { oauthRoute } from "@/lib/mcp-oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => oauthRoute(request, "metadata");
export const OPTIONS = GET;
