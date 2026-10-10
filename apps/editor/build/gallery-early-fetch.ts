import type { Plugin } from "vite";

import { galleryEarlyFetchScript } from "../src/gallery-early-fetch";

/**
 * Write the landing page's early Gallery requests into index.html (#1592),
 * just before the entry script: nothing above it is a stylesheet, which an
 * inline script would wait for, so the requests leave as the page is read.
 */
export function galleryEarlyFetch(): Plugin {
  return {
    name: "gallery-early-fetch",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const script = `<script>${galleryEarlyFetchScript()}</script>`;
        const entry = html.search(/<script\b[^>]*\btype="module"/u);
        if (entry === -1)
          throw new Error(
            "Gallery early fetch could not find the entry script",
          );
        return `${html.slice(0, entry)}${script}\n    ${html.slice(entry)}`;
      },
    },
  };
}
