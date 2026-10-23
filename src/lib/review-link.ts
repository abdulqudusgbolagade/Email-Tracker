// Only an internal draft-review destination may survive an unauthenticated login.
export function reviewReturn(value: unknown) {
  if (typeof value !== "string" || value.length > 300) return "/overview";
  try {
    const url = new URL(value, "https://grant.invalid");
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
