import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { editorPreload } from "./editor-preload";

function preload(path: string) {
  const handler = (
    editorPreload().transformIndexHtml as {
      handler: (html: string, context: unknown) => { children: string }[];
    }
  ).handler;
  const bundle = {
    "assets/App-12345678.js": {
      type: "chunk",
      fileName: "assets/App-12345678.js",
      facadeModuleId: "E:\\repo\\src\\app\\App.tsx",
      imports: ["assets/shared-12345678.js"],
      dynamicImports: ["assets/math-12345678.js"],
      viteMetadata: { importedCss: new Set(["assets/App-12345678.css"]) },
    },
    "assets/shared-12345678.js": { type: "chunk", imports: [] },
    "assets/math-12345678.js": { type: "chunk", imports: [] },
    "assets/gallery-feed-12345678.js": {
      type: "chunk",
      fileName: "assets/gallery-feed-12345678.js",
      facadeModuleId: "E:\\repo\\src\\components\\gallery-feed.tsx",
      imports: ["assets/gallery-shared-12345678.js"],
      viteMetadata: {
        importedCss: new Set(["assets/gallery-feed-12345678.css"]),
      },
    },
    "assets/gallery-shared-12345678.js": { type: "chunk", imports: [] },
  };
  const tags = handler("", { bundle });
  const links: { rel: string; href: string; as?: string }[] = [];
  runInNewContext(tags[0]!.children, {
    location: { pathname: path },
    document: {
      createElement: () => ({}),
      head: { appendChild: (link: (typeof links)[number]) => links.push(link) },
    },
  });
  return links;
}

describe("route resource preload", () => {
  it("downloads only eager Gallery resources on the landing route", () => {
    expect(preload("/")).toEqual([
      {
        rel: "modulepreload",
        href: "/assets/gallery-feed-12345678.js",
        crossOrigin: "anonymous",
      },
      {
        rel: "modulepreload",
        href: "/assets/gallery-shared-12345678.js",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: "/assets/gallery-feed-12345678.css",
        crossOrigin: "anonymous",
        as: "style",
      },
    ]);
  });
  it.each(["/analytics", "/mine", "/moderation", "/g/"])(
    "does not download route dependencies on %s",
    (path) => expect(preload(path)).toEqual([]),
  );
  it.each(["/editor", "/editor/", "/g/circuit-123"])(
    "downloads only eager editor resources on %s",
    (path) => {
      const links = preload(path);
      expect(links.map((link) => link.href)).toEqual([
        "/assets/App-12345678.js",
        "//assets/shared-12345678.js".slice(1),
        "/assets/App-12345678.css",
      ]);
      expect(links.at(-1)).toMatchObject({ rel: "preload", as: "style" });
    },
  );
});
