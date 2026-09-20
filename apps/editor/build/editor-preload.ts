import type { Plugin } from "vite";

/** Discover hashed resources from the build, never guess filenames at runtime. */
export function editorPreload(): Plugin {
  return {
    name: "editor-route-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const bundle = context.bundle;
        if (!bundle) return;
        const editorEntry = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.facadeModuleId?.replaceAll("\\", "/").endsWith("/app/App.tsx"),
        );
        const galleryEntry = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith("/components/gallery-feed.tsx"),
        );
        if (!editorEntry || editorEntry.type !== "chunk")
          throw new Error("Editor preload could not locate the App entry");
        if (!galleryEntry || galleryEntry.type !== "chunk") {
          throw new Error("Gallery preload could not locate the feed entry");
        }
        function resourcesFor(entryName: string): string[][] {
          const scripts = new Set<string>();
          const styles = new Set<string>();
          function visit(name: string) {
            if (scripts.has(name)) return;
            const chunk = bundle![name];
            if (!chunk || chunk.type !== "chunk") return;
            scripts.add(name);
            const metadata = (
              chunk as typeof chunk & {
                viteMetadata?: { importedCss: Set<string> };
              }
            ).viteMetadata;
            metadata?.importedCss.forEach((css) => styles.add(css));
            chunk.imports.forEach(visit);
          }
          visit(entryName);
          return [...scripts]
            .map((name) => ["modulepreload", "/" + name])
            .concat([...styles].map((name) => ["preload", "/" + name]));
        }
        const editorResources = resourcesFor(editorEntry.fileName);
        const galleryResources = resourcesFor(galleryEntry.fileName);
        return [
          {
            tag: "script",
            injectTo: "head",
            children: `const galleryResources = ${JSON.stringify(galleryResources).replaceAll("<", "\\u003c")}; const editorResources = ${JSON.stringify(editorResources).replaceAll("<", "\\u003c")}; const resources = /^\\/?$/.test(location.pathname) ? galleryResources : (/^\\/editor\\/?$/.test(location.pathname) || /^\\/g\\/[A-Za-z0-9-]{1,64}\\/?$/.test(location.pathname)) ? editorResources : []; for (const [rel, href] of resources) { const link = document.createElement("link"); link.rel = rel; link.href = href; link.crossOrigin = "anonymous"; if (rel === "preload") link.as = "style"; document.head.appendChild(link); }`,
          },
        ];
      },
    },
  };
}
