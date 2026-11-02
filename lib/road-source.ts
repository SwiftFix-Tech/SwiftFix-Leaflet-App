// Public static geometry only. Browser progress always stays in IndexedDB.
export function roadSource(value = ""): string {
  if (!value) return "/roads";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Road data URL must be a public HTTPS directory without credentials, query or fragment.",
    );
  return url.href.replace(/\/$/, "");
}
