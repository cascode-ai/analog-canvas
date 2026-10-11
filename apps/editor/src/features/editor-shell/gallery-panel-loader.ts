import {
  galleryFeedQueryKey,
  loadGalleryFeed,
  loadGalleryTagSummary,
} from "../../gallery-client";

/** One panel opening/refresh owns these in-flight reads; no completed-response TTL. */
export function createGalleryPanelLoader(fetcher: typeof fetch) {
  const feeds = new Map<string, ReturnType<typeof loadGalleryFeed>>();
  let tags: ReturnType<typeof loadGalleryTagSummary> | undefined;
  return {
    feed(query: NonNullable<Parameters<typeof loadGalleryFeed>[1]> = {}) {
      const key = JSON.stringify([
        galleryFeedQueryKey(query),
        query.cursor,
        query.limit,
        query.signedOutWall,
      ]);
      const existing = feeds.get(key);
      if (existing) return existing;
      const request = loadGalleryFeed(fetcher, query);
      feeds.set(key, request);
      const release = () => {
        if (feeds.get(key) === request) feeds.delete(key);
      };
      void request.then(release, release);
      return request;
    },
    tags() {
      if (tags) return tags;
      const request = loadGalleryTagSummary(fetcher);
      tags = request;
      const release = () => {
        if (tags === request) tags = undefined;
      };
      void request.then(release, release);
      return request;
    },
  };
}
