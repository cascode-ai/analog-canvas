import type { Plugin } from "vite";
import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "../src/agent/session-recovery-presence";
import { EXAMPLE_HOSTS, LOCAL_GALLERY_REPLICA } from "../src/gallery-source";

/**
 * Discover hashed resources from the build, never guess filenames at runtime.
 * The script goes before the first stylesheet or entry script: an inline
 * script waits for every stylesheet above it, which held the route's preloads
 * back a round trip on a first visit (#1645).
 *
 * The Agent runtime is no route's resource (#1673). A tab that holds a saved
 * Agent session, or a page asked to pair automation (`?agent=pair`), needs
 * it at once on any route, so those preload it too.
 */
export function editorPreload(): Plugin {
  return {
    name: "editor-route-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        if (!bundle) return;
        const editorEntry = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith("/entries/web-editor.tsx"),
        );
        const galleryEntry = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith("/components/gallery-feed.tsx"),
        );
        if (!editorEntry || editorEntry.type !== "chunk")
          throw new Error(
            "Editor preload could not locate the Web editor entry",
          );
        if (!galleryEntry || galleryEntry.type !== "chunk") {
          throw new Error("Gallery preload could not locate the feed entry");
        }
        const agentRuntime = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith("/agent/agent-runtime.tsx"),
        );
        if (!agentRuntime || agentRuntime.type !== "chunk")
          throw new Error("Agent preload could not locate the Agent runtime");
        function resourcesFor(entryName: string): string[][] {
          const scripts = new Set<string>();
          const styles = new Set<string>();
          const fonts = new Set<string>();
          function visit(name: string) {
            if (scripts.has(name)) return;
            const chunk = bundle![name];
            if (!chunk || chunk.type !== "chunk") return;
            scripts.add(name);
            const metadata = (
              chunk as typeof chunk & {
                viteMetadata?: {
                  importedCss: Set<string>;
                  importedAssets: Set<string>;
                };
              }
            ).viteMetadata;
            metadata?.importedCss.forEach((css) => styles.add(css));
            // Metropolis draws every schematic label, so the canvas asks for
            // its faces as soon as it appears (#1673). DejaVu Sans only
            // draws the symbols Metropolis lacks and loads when one shows.
            metadata?.importedAssets.forEach((asset) => {
              if (/(?:^|\/)Metropolis-[^/]*\.woff2$/u.test(asset))
                fonts.add(asset);
            });
            chunk.imports.forEach(visit);
          }
          visit(entryName);
          return [...scripts]
            .map((name) => ["modulepreload", "/" + name])
            .concat(
              [...styles, ...fonts].map((name) => ["preload", "/" + name]),
            );
        }
        // The page's own entry, the modules it already preloads and its
        // stylesheet load anyway: asked for again, each was fetched twice
        // (2026-10-14).
        const inPage = new Set(
          [...html.matchAll(/\b(?:href|src)="(\/assets\/[^"]+)"/gu)].map(
            (match) => match[1],
          ),
        );
        const notInPage = (resources: string[][]) =>
          resources.filter(([, href]) => !inPage.has(href));
        const editorResources = notInPage(resourcesFor(editorEntry.fileName));
        const galleryResources = notInPage(resourcesFor(galleryEntry.fileName));
        const agentResources = notInPage(resourcesFor(agentRuntime.fileName));
        const script = `<script>const galleryResources = ${JSON.stringify(galleryResources).replaceAll("<", "\\u003c")}; const editorResources = ${JSON.stringify(editorResources).replaceAll("<", "\\u003c")}; const agentResources = ${JSON.stringify(agentResources).replaceAll("<", "\\u003c")}; const localExamples = ${JSON.stringify(EXAMPLE_HOSTS)}.includes(location.hostname) && window.${LOCAL_GALLERY_REPLICA} !== true; const routeResources = /^\\/?$/.test(location.pathname) ? (localExamples ? [] : galleryResources) : (/^\\/editor\\/?$/.test(location.pathname) || /^\\/g\\/[A-Za-z0-9-]{1,64}\\/?$/.test(location.pathname)) ? editorResources : []; let agentNeeded = false; try { agentNeeded = new URLSearchParams(location.search).get("agent") === "pair" || sessionStorage.getItem(${JSON.stringify(AGENT_SESSION_RECOVERY_STORAGE_KEY)}) !== null; } catch {} const resources = agentNeeded ? routeResources.concat(agentResources.filter(([, href]) => !routeResources.some((resource) => resource[1] === href))) : routeResources; for (const [rel, href] of resources) { const link = document.createElement("link"); link.rel = rel; link.href = href; link.crossOrigin = "anonymous"; if (rel === "preload") link.as = href.endsWith(".css") ? "style" : "font"; document.head.appendChild(link); }</script>`;
        const first = html.search(
          /<(?:link\b[^>]*\brel="stylesheet"|script\b[^>]*\btype="module")/u,
        );
        if (first === -1)
          throw new Error(
            "Editor preload could not find a stylesheet or entry script",
          );
        return `${html.slice(0, first)}${script}\n    ${html.slice(first)}`;
      },
    },
  };
}
