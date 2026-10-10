/**
 * The landing page's first Gallery requests, started by an inline script in
 * index.html as soon as the browser reads it (#1592), beside the entry
 * script's download instead of after it has run. The wall's own loaders then
 * take those responses when they ask for the same URL. No imports: the build
 * reads this module too.
 */

/** The first page and its tag counts, as the unfiltered wall asks for them. */
export const GALLERY_EARLY_URLS = [
  "/api/gallery",
  "/api/gallery/tags",
] as const;

const GALLERY_EARLY_GLOBAL = "__icmGalleryEarly";

type EarlyResponses = Record<string, Promise<Response>>;

/** The inline script: on the landing route, request each URL once. */
export function galleryEarlyFetchScript(): string {
  return (
    `if(/^\\/?$/.test(location.pathname)){var early=window.${GALLERY_EARLY_GLOBAL}={};` +
    `${JSON.stringify(GALLERY_EARLY_URLS)}.forEach(function(url){` +
    `var response=fetch(url,{credentials:"same-origin"});` +
    `response.catch(function(){});early[url]=response;});}`
  );
}

/**
 * A fetch that answers a URL the inline script already requested with that
 * response, once; any other request, or the same one again, goes out.
 */
export function earlyGalleryFetch(
  responses: EarlyResponses | undefined = (
    globalThis as { [GALLERY_EARLY_GLOBAL]?: EarlyResponses }
  )[GALLERY_EARLY_GLOBAL],
  fallback: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : null;
    const early = url === null ? undefined : responses?.[url];
    if (url !== null && early) {
      delete responses![url];
      return early;
    }
    return fallback(input, init);
  };
}
