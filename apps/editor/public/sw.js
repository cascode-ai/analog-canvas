// This worker owns only the static application shell. User Projects and
// browser recovery records are deliberately outside Cache Storage.
// Replaced by the Vite build with a digest of the emitted index.html. This
// changes when its content-hashed application asset graph changes, allowing
// activate() to remove the prior shell instead of retaining it indefinitely.
const CACHE = "icm-static-shell-__ICM_BUILD_ID__";

function scopeUrl() {
  return new URL(self.registration.scope);
}

function shellUrls() {
  const scope = scopeUrl();
  return [
    new URL("./", scope).toString(),
    new URL("manifest.webmanifest", scope).toString(),
    new URL("icon.svg", scope).toString(),
    new URL("icon-192.png", scope).toString(),
    new URL("icon-512.png", scope).toString(),
  ];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(shellUrls())),
  );
  // Do not skipWaiting: a new shell must never take over an editor with
  // unsaved in-memory work. The browser activates it after the old client ends.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("icm-static-shell-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

function isStaticAsset(request) {
  return ["script", "style", "image", "font", "manifest"].includes(
    request.destination,
  );
}

/**
 * Whether a response is the kind of thing the request asked for.
 *
 * Asset names carry a content hash, so this cache is keyed on names that
 * promise never to change meaning — which makes a wrong answer permanent.
 * A single-page-application fallback answers a missing asset with the app
 * shell under `200 text/html`; caching that as a script would leave the name
 * broken for as long as the cache lives, long after the deploy that caused
 * it. Store only what matches.
 */
function servesWhatWasAsked(request, response) {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type) return true;
  if (request.destination === "script") return type.includes("javascript");
  if (request.destination === "style") return type.includes("css");
  return !type.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Navigation is network-first so a deployed build can replace index.html and
  // point at its fresh, content-hashed Vite assets. Offline falls back only to
  // the known shell, never to a Project or arbitrary cached request.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            void caches
              .open(CACHE)
              .then((cache) => cache.put(scopeUrl(), response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(scopeUrl())),
    );
    return;
  }

  // Only same-origin static assets are cached. This intentionally excludes
  // arbitrary GETs, imported files, Project downloads, and future APIs.
  if (
    isStaticAsset(event.request) &&
    event.request.url.startsWith(scopeUrl().origin)
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && servesWhatWasAsked(event.request, response)) {
            void caches
              .open(CACHE)
              .then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        });
      }),
    );
  }
});
