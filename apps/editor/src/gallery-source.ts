/** Shared by the HTML preloader and runtime; no Gallery or editor dependencies. */
export const EXAMPLE_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;
export const LOCAL_GALLERY_REPLICA = "__icmLocalGalleryReplica";

/** Local replica is explicit host configuration, never inferred from an API response. */
export function localhostExamplesEnabled(
  hostname = globalThis.location?.hostname ?? "",
  replica = (globalThis as { [LOCAL_GALLERY_REPLICA]?: boolean })[
    LOCAL_GALLERY_REPLICA
  ] === true,
): boolean {
  return !replica && EXAMPLE_HOSTS.some((host) => host === hostname);
}
