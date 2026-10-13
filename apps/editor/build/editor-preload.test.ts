import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "../src/agent/session-recovery-presence";
import { PHONE_EDITOR_KEY, PHONE_QUERY } from "../src/phone-viewing";
import { editorPreload } from "./editor-preload";

const builtHead = `<head>
    <meta charset="UTF-8" />
    <title>Analog Canvas</title>
    <script>document.documentElement.classList.add("light");</script>
    <script type="module" crossorigin src="/assets/index-12345678.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/jsx-runtime-12345678.js">
    <link rel="stylesheet" crossorigin href="/assets/index-12345678.css">
  </head>`;

function transform(html: string) {
  const handler = (
    editorPreload().transformIndexHtml as {
      handler: (html: string, context: unknown) => string;
    }
  ).handler;
  return handler(html, { bundle });
}

function preloadScript(html: string): string {
  const script = /<script>(const galleryResources[^<]*)<\/script>/u.exec(html);
  if (!script) throw new Error("No route preload script");
  return script[1]!;
}

const bundle = {
  "assets/web-editor-12345678.js": {
    type: "chunk",
    fileName: "assets/web-editor-12345678.js",
    facadeModuleId: "E:\\repo\\src\\entries\\web-editor.tsx",
    imports: ["assets/App-12345678.js", "assets/web-services-12345678.js"],
  },
  "assets/web-services-12345678.js": { type: "chunk", imports: [] },
  "assets/App-12345678.js": {
    type: "chunk",
    fileName: "assets/App-12345678.js",
    facadeModuleId: "E:\\repo\\src\\app\\App.tsx",
    imports: ["assets/shared-12345678.js"],
    dynamicImports: ["assets/math-12345678.js"],
    viteMetadata: {
      importedCss: new Set(["assets/App-12345678.css"]),
      importedAssets: new Set([
        "assets/Metropolis-Regular.schematic-12345678.woff2",
        "assets/DejaVuSans.schematic-12345678.woff2",
        "assets/icon-12345678.svg",
      ]),
    },
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
      importedAssets: new Set(),
    },
  },
  "assets/gallery-shared-12345678.js": { type: "chunk", imports: [] },
  "assets/agent-runtime-12345678.js": {
    type: "chunk",
    fileName: "assets/agent-runtime-12345678.js",
    facadeModuleId: "E:\\repo\\src\\agent\\agent-runtime.tsx",
    imports: ["assets/shared-12345678.js", "assets/agent-adapter-12345678.js"],
  },
  "assets/agent-adapter-12345678.js": { type: "chunk", imports: [] },
};

function preload(
  path: string,
  hostname = "analog-canvas.test",
  replica = false,
  {
    search = "",
    saved = {},
    phone = false,
  }: { search?: string; saved?: Record<string, string>; phone?: boolean } = {},
) {
  const links: { rel: string; href: string; as?: string }[] = [];
  runInNewContext(preloadScript(transform(builtHead)), {
    location: { pathname: path, hostname, search },
    URLSearchParams,
    matchMedia: (query: string) => ({
      matches: phone && query === PHONE_QUERY,
    }),
    sessionStorage: { getItem: (key: string) => saved[key] ?? null },
    window: { __icmLocalGalleryReplica: replica },
    document: {
      createElement: () => ({}),
      head: { appendChild: (link: (typeof links)[number]) => links.push(link) },
    },
  });
  return links;
}

describe("route resource preload", () => {
  it("asks again for nothing the page itself loads or preloads (2026-10-14)", () => {
    // Asked for twice, each such module was fetched twice on every visit.
    const script = preloadScript(
      transform(
        builtHead.replace(
          "jsx-runtime-12345678.js",
          "gallery-shared-12345678.js",
        ),
      ),
    );
    expect(script).not.toContain("/assets/gallery-shared-12345678.js");
    expect(script).not.toContain("/assets/index-12345678.css");
    expect(script).toContain("/assets/gallery-feed-12345678.js");
  });

  it("fetches no editor on a phone, which views circuits instead (2026-10-14)", () => {
    const hrefs = (path: string, options: Parameters<typeof preload>[3]) =>
      preload(path, undefined, false, options).map((link) => link.href);
    expect(hrefs("/editor", { phone: true })).toEqual([]);
    expect(hrefs("/g/abc", { phone: true })).toEqual([]);
    // The Gallery still loads ahead on a phone.
    expect(hrefs("/", { phone: true })).toContain(
      "/assets/gallery-feed-12345678.js",
    );
    // Someone who opened the editor anyway gets it ahead as on a computer.
    expect(
      hrefs("/editor", { phone: true, saved: { [PHONE_EDITOR_KEY]: "1" } }),
    ).toEqual(hrefs("/editor", {}));
    expect(hrefs("/editor", {})).toContain("/assets/web-editor-12345678.js");
  });

  it("runs before any stylesheet, which an inline script would wait for", () => {
    const html = transform(builtHead);
    const script = html.indexOf("<script>const galleryResources");
    expect(script).toBeGreaterThan(html.indexOf('<meta charset="UTF-8" />'));
    expect(script).toBeLessThan(html.indexOf('rel="stylesheet"'));
    expect(script).toBeLessThan(html.indexOf('type="module"'));
  });

  it("runs before a stylesheet that precedes the entry script", () => {
    const stylesheet =
      '<link rel="stylesheet" crossorigin href="/assets/index-12345678.css">';
    const html = transform(
      builtHead
        .replace(`\n    ${stylesheet}`, "")
        .replace(
          '<script type="module"',
          `${stylesheet}\n    <script type="module"`,
        ),
    );
    const script = html.indexOf("<script>const galleryResources");
    expect(html.indexOf('rel="stylesheet"')).toBeLessThan(
      html.indexOf('type="module"'),
    );
    expect(script).toBeGreaterThan(html.indexOf("<title>"));
    expect(script).toBeLessThan(html.indexOf('rel="stylesheet"'));
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "does not preload Gallery on ordinary %s, but keeps explicit replica support",
    (hostname) => {
      expect(preload("/", hostname)).toEqual([]);
      expect(preload("/", hostname, true)).toEqual(preload("/"));
      expect(preload("/editor", hostname)).toEqual(preload("/editor"));
    },
  );
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
        "/assets/web-editor-12345678.js",
        "/assets/App-12345678.js",
        "//assets/shared-12345678.js".slice(1),
        "/assets/web-services-12345678.js",
        "/assets/App-12345678.css",
        "/assets/Metropolis-Regular.schematic-12345678.woff2",
      ]);
      expect(links.at(-2)).toMatchObject({ rel: "preload", as: "style" });
      // The label face every schematic draws; DejaVu loads when a symbol
      // needs it.
      expect(links.at(-1)).toMatchObject({
        rel: "preload",
        as: "font",
        crossOrigin: "anonymous",
      });
    },
  );

  it("leaves the Agent runtime to the page that asks for it (#1673)", () => {
    for (const path of ["/", "/editor", "/g/circuit-123", "/privacy"])
      expect(preload(path).some((link) => link.href.includes("agent-"))).toBe(
        false,
      );
  });

  it.each([
    [
      "a saved Agent session",
      { saved: { [AGENT_SESSION_RECOVERY_STORAGE_KEY]: "{}" } },
    ],
    ["automation pairing", { search: "?agent=pair" }],
  ])("preloads the Agent runtime once for %s (#1673)", (_case, page) => {
    expect(
      preload("/editor", undefined, false, page).map((link) => link.href),
    ).toEqual([
      ...preload("/editor").map((link) => link.href),
      "/assets/agent-runtime-12345678.js",
      "/assets/agent-adapter-12345678.js",
    ]);
    // Where the route preloads nothing, as on /privacy, the runtime still is.
    expect(
      preload("/privacy", undefined, false, page).map((link) => link.href),
    ).toEqual([
      "/assets/agent-runtime-12345678.js",
      "/assets/shared-12345678.js",
      "/assets/agent-adapter-12345678.js",
    ]);
  });
});
