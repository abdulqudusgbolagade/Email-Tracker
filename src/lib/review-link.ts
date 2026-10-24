// Only validated internal draft-review and OAuth consent destinations survive login.
export function reviewReturn(value: unknown) {
  if (typeof value !== "string" || value.length > 300) return "/overview";
  try {
    const url = new URL(value, "https://grant.invalid");
    if (
      url.origin === "https://grant.invalid" &&
      url.pathname === "/mcp/authorize" &&
      !url.hash &&
      url.searchParams.size === 1 &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("request") || "")
    )
      return `/mcp/authorize?${new URLSearchParams({ request: url.searchParams.get("request")! })}`;
    const drafts = url.searchParams.getAll("draft");
    if (
      url.origin !== "https://grant.invalid" ||
      url.pathname !== "/compose" ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "draft") ||
      drafts.length !== 1 ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(drafts[0])
    )
      return "/overview";
    return `/compose?${new URLSearchParams({ draft: drafts[0] })}`;
  } catch {
    return "/overview";
  }
}
