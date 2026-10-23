import type { Plugin } from "vite";
import { SITE_USAGE_NOTE } from "../src/usage-policy-note";

/** Vite writes a tag's text as given, so the note is escaped here. */
function htmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The page shell states the usage policy to programs that read HTML without
 * running it: a robots meta asking AI tools not to train on the page, and a
 * noscript note. The rendered Gallery shows the same note in its footnote.
 */
export function usagePolicyShell(): Plugin {
  return {
    name: "usage-policy-shell",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { name: "robots", content: "noai, noimageai" },
        injectTo: "head",
      },
      {
        tag: "noscript",
        children: htmlText(SITE_USAGE_NOTE),
        injectTo: "body-prepend",
      },
    ],
  };
}
