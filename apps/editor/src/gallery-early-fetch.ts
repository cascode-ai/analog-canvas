/**
 * The landing page's first Gallery requests, started by an inline script in
 * index.html as soon as the browser reads it (#1592), beside the entry
 * script's download instead of after it has run. The wall's own loaders then
 * take those responses when they ask for the same URL. The build reads this
 * module too, so it imports only gallery-order, which imports nothing.
 */
import {
  GALLERY_ORDER_KEY,
  GALLERY_SEED_GLOBAL,
  STORED_GALLERY_ORDERS,
  type GalleryOrder,
} from "./gallery-order";
import { EXAMPLE_HOSTS, LOCAL_GALLERY_REPLICA } from "./gallery-source";

/**
 * The first page and its tag counts, as the unfiltered wall asks for them in
 * the order it opens with (#1615); a shuffle names its seed.
 */
export function galleryEarlyUrls(
  order: GalleryOrder,
  seed: string,
): [string, string] {
  const feed =
    order === "random"
      ? `/api/gallery?order=random&seed=${seed}`
      : order === "newest"
        ? "/api/gallery"
        : `/api/gallery?order=${order}`;
  return [feed, "/api/gallery/tags"];
}

const GALLERY_EARLY_GLOBAL = "__icmGalleryEarly";

/** Where the wall remembers its filters: gallery-filters' GALLERY_FILTERS_KEY. */
export const GALLERY_EARLY_FILTERS_KEY = "icm.gallery-filters.v1";

/**
 * Whether the wall opens unfiltered, so that the early requests are the ones
 * it will ask: the address carries no query, and the remembered filters
 * narrow nothing the first page is asked with (or cannot be read, which
 * resolveGalleryFilters reads as none). A narrowed wall asks for itself, and
 * an early unfiltered request would only be wasted.
 */
const OPENS_UNFILTERED =
  `function(search,raw){if(search)return false;var s;` +
  `try{s=raw&&JSON.parse(raw)}catch(e){return true}` +
  `if(!s||typeof s!=="object"||Array.isArray(s))return true;` +
  `function text(v){return typeof v==="string"&&v.trim()!==""}` +
  `function list(v){return Array.isArray(v)&&v.length>0}` +
  `return!(text(s.author)||text(s.ownerUserId)||text(s.source)||list(s.tags)||` +
  `list(s.parts)||s.netlistable===true||s.liked===true||s.attention===true)}`;

type EarlyResponses = Record<string, Promise<Response>>;

/**
 * The inline script: on the landing route of a wall that opens unfiltered,
 * request each URL once.
 */
export function galleryEarlyFetchScript(): string {
  const tagsUrl = galleryEarlyUrls("newest", "")[1];
  const keptOrderUrls = Object.fromEntries(
    STORED_GALLERY_ORDERS.map((order) => [
      order,
      galleryEarlyUrls(order, "")[0],
    ]),
  );
  const shuffledUrl = galleryEarlyUrls("random", "")[0];
  return (
    `if(/^\\/?$/.test(location.pathname)&&(${JSON.stringify(EXAMPLE_HOSTS)}.indexOf(location.hostname)<0||window.${LOCAL_GALLERY_REPLICA}===true)){var raw=null;` +
    `try{raw=localStorage.getItem(${JSON.stringify(GALLERY_EARLY_FILTERS_KEY)})}catch(e){}` +
    `if((${OPENS_UNFILTERED})(location.search,raw)){` +
    `var early=window.${GALLERY_EARLY_GLOBAL}={};` +
    // The order the wall opens with (#1615): the reader's kept choice, or a
    // shuffle whose seed the wall then takes up. The URLs are galleryEarlyUrls'.
    `var order="random";try{var kept=localStorage.getItem(${JSON.stringify(GALLERY_ORDER_KEY)});` +
    `if(${JSON.stringify(STORED_GALLERY_ORDERS)}.indexOf(kept)>=0)order=kept}catch(e){}` +
    `var feed=${JSON.stringify(keptOrderUrls)}[order];if(order==="random"){` +
    `var seed=Math.random().toString(36).slice(2,10)||"s0";window.${GALLERY_SEED_GLOBAL}=seed;` +
    `feed=${JSON.stringify(shuffledUrl)}+seed}` +
    `[feed,${JSON.stringify(tagsUrl)}].forEach(function(url){` +
    `var response=fetch(url,{credentials:"same-origin"});` +
    `response.catch(function(){});early[url]=response;});}}`
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
