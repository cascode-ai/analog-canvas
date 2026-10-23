// Production smoke: serve the already-built editor through Vite's real
// preview server and inspect it in Chromium. --check is intentionally
// read-only; normal mode refreshes the committed report.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const workspace = process.cwd();
const editorRoot = resolve(workspace, "apps/editor");
const editorDist = resolve(editorRoot, "dist");
const reportPath = resolve(
  workspace,
  "fixtures/editor-production-smoke/report.json",
);
const check = process.argv.includes("--check");

async function builtJavaScriptContains(needle) {
  const entries = await readdir(editorDist, { recursive: true });
  const scripts = entries.filter((entry) => entry.endsWith(".js"));
  const contents = await Promise.all(
    scripts.map((entry) => readFile(resolve(editorDist, entry), "utf8")),
  );
  return contents.some((content) => content.includes(needle));
}

// Whether a script the route preloads, and so every first visit downloads,
// contains the needle. Read from the built page, not from one loaded page,
// so code that loads later (the Netlist panel's editor) does not count.
async function routePreloadContains(html, route, needle) {
  const match = new RegExp(
    `const ${route}Resources = (\\[\\[.*?\\]\\]);`,
    "s",
  ).exec(html);
  if (!match) throw new Error(`No ${route} preload resources in index.html`);
  const scripts = JSON.parse(match[1])
    .filter(([rel]) => rel === "modulepreload")
    .map(([, href]) => href.replace(/^\/+/u, ""));
  const contents = await Promise.all(
    scripts.map((path) => readFile(resolve(editorDist, path), "utf8")),
  );
  return contents.some((content) => content.includes(needle));
}

async function loadedJavaScriptContains(page, needle) {
  const paths = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.endsWith(".js")),
  );
  const uniquePaths = [...new Set(paths)];
  const contents = await Promise.all(
    uniquePaths.map(async (pathname) => {
      const relativePath = pathname.replace(/^\/+/, "");
      return readFile(resolve(editorDist, relativePath), "utf8");
    }),
  );
  return contents.some((content) => content.includes(needle));
}

async function loadedJavaScriptPathContains(page, needle) {
  return page.evaluate(
    (expected) =>
      performance
        .getEntriesByType("resource")
        .some(
          (entry) =>
            new URL(entry.name).pathname.endsWith(".js") &&
            new URL(entry.name).pathname.includes(expected),
        ),
    needle,
  );
}

async function loadedStylesheetContains(page, needle) {
  const paths = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.endsWith(".css")),
  );
  const uniquePaths = [...new Set(paths)];
  const contents = await Promise.all(
    uniquePaths.map(async (pathname) => {
      const relativePath = pathname.replace(/^\/+/, "");
      return readFile(resolve(editorDist, relativePath), "utf8");
    }),
  );
  return contents.some((content) => content.includes(needle));
}

// Where the Netlist panel's code sits: the line-number gutter's width and
// the first character of code, relative to the panel's code box. "plain" is
// code with no gutter, such as a bare text box.
function netlistCodeLayout() {
  const view = document.querySelector(".netlist-code-viewport > *");
  if (!view) return null;
  const gutter = view.querySelector(".cm-gutters, .static-code-gutter");
  const content = view.querySelector(".cm-content, .static-code-content");
  if (!gutter || !content) return "plain";
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !/\S/u.test(node.data)) node = walker.nextNode();
  if (!node) return "empty";
  const start = node.data.search(/\S/u);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + 1);
  const box = view.getBoundingClientRect();
  const text = range.getBoundingClientRect();
  const edge = gutter.getBoundingClientRect();
  // The middle of a line, unlike its glyphs' top, hardly moves with the
  // font: a web font arriving meanwhile is not a change of layout.
  return [edge.width, text.x - box.x, text.y + text.height / 2 - box.y];
}

// Every loading screen a first /editor visit reveals, in order, on a fresh
// profile over a slow link where the route's chunks arrive over time. React
// keeps a revealed fallback for at least 300 ms, so each further stage costs
// that much (#1645). The Netlist panel, open by default, loads its code
// editor after the editor appears; whatever it shows first must already be
// laid out as that editor lays out its code (#1673).
async function editorLoadingScreensOf(browser, url) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await page.addInitScript(
      `window.__icmNetlistCodeLayout = ${netlistCodeLayout}`,
    );
    await page.addInitScript(() => {
      const seen = (window.__icmLoadingScreens = []);
      new MutationObserver((records) => {
        // Observers run before the browser paints what the records added.
        window.__icmFirstNetlistLayout ??=
          window.__icmNetlistCodeLayout() ?? undefined;
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const screens = node.matches(".analytics-loading")
              ? [node]
              : node.querySelectorAll(".analytics-loading");
            for (const screen of screens) seen.push(screen.textContent ?? "");
          }
      }).observe(document, { childList: true, subtree: true });
    });
    const network = await context.newCDPSession(page);
    await network.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: 10_000_000 / 8,
      uploadThroughput: 5_000_000 / 8,
    });
    await page.goto(new URL("editor", url).href);
    await page.waitForSelector('[data-testid="schematic-canvas"]', {
      timeout: 30_000,
    });
    const screens = await page.evaluate(() => window.__icmLoadingScreens);
    await page.waitForSelector(".netlist-code-viewport .cm-content", {
      timeout: 30_000,
    });
    const [first, loaded] = await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              done([
                window.__icmFirstNetlistLayout,
                window.__icmNetlistCodeLayout(),
              ]),
            ),
          ),
        ),
    );
    // Within a pixel: subpixel text positions are not a visible move.
    const netlistLayoutChangedOnLoad = !(
      Array.isArray(first) &&
      Array.isArray(loaded) &&
      first.every((value, index) => Math.abs(value - loaded[index]) <= 1)
    );
    return { screens, netlistLayoutChangedOnLoad };
  } finally {
    await context.close();
  }
}

async function main() {
  const expected = check
    ? JSON.parse(await readFile(reportPath, "utf8"))
    : null;
  const { preview } = await import("vite");
  let server;
  let browser;
  const consoleErrors = [];
  let mounted = false;
  let projectDataIsolation = "unchecked";
  let galleryEditorCodeLoaded = true;
  let editorCodeLoaded = false;
  let galleryEditorStylesLoaded = true;
  let editorStylesLoaded = false;
  let galleryPdfRuntimeLoaded = true;
  let editorPdfRuntimeLoaded = true;
  let editorLoadingScreens = [];
  let editorNetlistLayoutChangedOnLoad = true;
  let editorSimulationServiceLoaded = true;
  let editorSchematicFonts = [];
  let editorJsonParserLoaded = true;
  let editorAgentRuntimeLoaded = true;
  try {
    server = await preview({
      root: editorRoot,
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: 4174, strictPort: true },
    });
    const url = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4174/";
    browser = await chromium.launch(
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : { channel: process.env.CI ? undefined : "chrome" },
    );
    ({
      screens: editorLoadingScreens,
      netlistLayoutChangedOnLoad: editorNetlistLayoutChangedOnLoad,
    } = await editorLoadingScreensOf(browser, url));
    const page = await browser.newPage();
    // This acceptance checks the hosted Gallery contract on a loopback server.
    // Ordinary loopback Examples have their own browser workflow.
    await page.addInitScript(() => {
      window.__icmLocalGalleryReplica = true;
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    // The production build serves two surfaces: the gallery feed at the
    // root and the full editor at /editor. Both must mount.
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="gallery-feed"]', {
      timeout: 10_000,
    });
    if (await loadedJavaScriptPathContains(page, "library-examples-"))
      throw new Error("Hosted Gallery loaded localhost examples");
    galleryEditorCodeLoaded = await loadedJavaScriptContains(
      page,
      "schematic-canvas",
    );
    galleryEditorStylesLoaded = await loadedStylesheetContains(
      page,
      ".schematic-canvas",
    );
    galleryPdfRuntimeLoaded = await loadedJavaScriptPathContains(
      page,
      "browser-pdf-",
    );
    if (
      await loadedJavaScriptContains(
        page,
        "Unrecognized extension value in extension set",
      )
    ) {
      throw new Error("Gallery loaded the code editor runtime eagerly");
    }
    await page.goto(new URL("editor", url).href, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector('[data-testid="schematic-canvas"]', {
      timeout: 10_000,
    });
    // The service runtime loads when a simulation needs it, not with the
    // editor (#1645).
    editorSimulationServiceLoaded = await loadedJavaScriptContains(
      page,
      "This deployment does not advertise simulation capabilities",
    );
    // The Agent adapter and the editor's Agent runtime load when Connect
    // Agent, a saved session or automation pairing asks for them (#1673).
    editorAgentRuntimeLoaded =
      (await loadedJavaScriptContains(
        page,
        "Snapshot permission is not granted",
      )) ||
      (await loadedJavaScriptContains(
        page,
        "The Agent session is bound to a Project that has been replaced",
      ));
    editorCodeLoaded = await loadedJavaScriptContains(page, "schematic-canvas");
    editorStylesLoaded = await loadedStylesheetContains(
      page,
      ".schematic-canvas",
    );
    editorPdfRuntimeLoaded = await loadedJavaScriptPathContains(
      page,
      "browser-pdf-",
    );
    // The schematic faces the canvas asked for, by name and initiator
    // (#1673).
    editorSchematicFonts = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => /\.schematic-[^/]*$/u.test(entry.name))
        .map(
          (entry) =>
            `${new URL(entry.name).pathname
              .replace(/^.*\//u, "")
              .replace(
                /\.schematic-.*(\.\w+)$/u,
                ".schematic$1",
              )} ${entry.initiatorType}`,
        )
        .sort(),
    );
    // Netlist is requested by the default editor workspace. Its CodeMirror
    // runtime must load here; only the Gallery keeps editor code deferred.
    await page.waitForSelector(
      '[aria-label="Netlist code"][contenteditable="true"]',
    );
    // That editor's SPICE mode needs no JSON grammar: a JSON view loads it
    // when one opens (#1673).
    await page.waitForLoadState("networkidle");
    editorJsonParserLoaded = await loadedJavaScriptContains(page, "JsonText");
    await page.getByTestId("examples-toggle").click();
    await page.getByTestId("examples-panel").waitFor();
    await page.waitForLoadState("networkidle");
    if (await loadedJavaScriptPathContains(page, "library-examples-"))
      throw new Error("Hosted Editor Gallery panel loaded localhost examples");
    await page.getByTestId("examples-toggle").click();
    // The first page installs the SW; a controlled navigation must actually
    // cache consumed JS bodies, not only the five install-time icons/shell.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="schematic-canvas"]');
    const cachedEditorScript = await page.evaluate(async () => {
      const script = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => /\/assets\/App-[^/]+\.js$/.test(url));
      for (let attempt = 0; attempt < 50; attempt++) {
        // Inspect the stored request, including its Vary headers; a synthetic
        // Request here lacks the module request's Origin header.
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          const key = (await cache.keys()).find(
            (request) => request.url === script,
          );
          if (key && (await cache.match(key))) return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    });
    if (!cachedEditorScript)
      throw new Error("Service worker did not cache the editor script");
    mounted = true;
    // Browser recovery is Project data and must never leak into the PWA
    // asset caches (Cache Storage) or the service-worker precache.
    projectDataIsolation = await page.evaluate(async () => {
      if (typeof caches === "undefined") return "caches-unavailable";
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          if (!response) continue;
          // Build JS legitimately contains bundled examples and schema names.
          // Those are application code, not a user's recovery/project payload.
          const path = new URL(request.url).pathname;
          const type = response.headers.get("content-type") ?? "";
          if (
            path.startsWith("/assets/") &&
            /javascript|css|font|image/.test(type)
          )
            continue;
          if (path.startsWith("/api/"))
            return `api-data-in-cache:${request.url}`;
          const text = await response.text();
          if (
            text.includes('"topDocumentId"') ||
            text.includes('"schemaVersion"')
          ) {
            return `project-data-in-cache:${name}:${request.url}`;
          }
        }
      }
      return "clean";
    });
  } finally {
    await browser?.close();
    await server?.close();
  }

  const nodeCryptoExternalized = await builtJavaScriptContains(
    "node:crypto has been externalized",
  );
  // An inline script waits for every stylesheet above it.
  const builtHtml = await readFile(resolve(editorDist, "index.html"), "utf8");
  const routePreload = builtHtml.indexOf("<script>const galleryResources");
  const firstStylesheet = builtHtml.search(/<link\b[^>]*\brel="stylesheet"/u);
  const routePreloadBeforeStylesheets =
    routePreload !== -1 &&
    (firstStylesheet === -1 || routePreload < firstStylesheet);
  // The artifact codec worker only compresses and digests files; the
  // circuit model's schema (its "structureRevision" field) has no place in
  // it (#1673).
  const codecWorkers = (await readdir(resolve(editorDist, "assets"))).filter(
    (name) => /^artifact-codec\.worker-.*\.js$/u.test(name),
  );
  if (codecWorkers.length !== 1)
    throw new Error("The build has no single artifact codec worker");
  const artifactCodecWorkerBundlesModel = (
    await readFile(resolve(editorDist, "assets", codecWorkers[0]), "utf8")
  ).includes("structureRevision");
  // The JSON grammar behind the property code views' inline controls loads
  // with those views (#1673). "JsonText" is its top node's name.
  const editorFirstLoadJsonParser = await routePreloadContains(
    builtHtml,
    "editor",
    "JsonText",
  );
  // @icm/rnl (writer, importer and symbol table) loads with the first RNL
  // use (#1749 put it on first load). "rnl-std-basic" names the table's
  // RNL standard package.
  const editorFirstLoadRnl = await routePreloadContains(
    builtHtml,
    "editor",
    "rnl-std-basic",
  );
  // Nor does the /editor route preload list name the runtime's chunk.
  const editorRoutePreload =
    /const editorResources = (\[\[.*?\]\]);/su.exec(builtHtml)?.[1] ?? "";
  const editorAgentRuntimePreloaded =
    editorRoutePreload === "" ||
    /\/assets\/agent-runtime-[\w-]{8}\.js/u.test(editorRoutePreload);
  const report = {
    mounted,
    consoleErrors,
    nodeCryptoExternalized,
    projectDataIsolation,
    galleryEditorCodeLoaded,
    editorCodeLoaded,
    galleryEditorStylesLoaded,
    editorStylesLoaded,
    galleryPdfRuntimeLoaded,
    editorPdfRuntimeLoaded,
    editorLoadingScreens,
    editorNetlistLayoutChangedOnLoad,
    editorSimulationServiceLoaded,
    editorAgentRuntimeLoaded,
    editorAgentRuntimePreloaded,
    routePreloadBeforeStylesheets,
    editorFirstLoadJsonParser,
    editorFirstLoadRnl,
    editorJsonParserLoaded,
    editorSchematicFonts,
    artifactCodecWorkerBundlesModel,
  };

  if (check) {
    if (JSON.stringify(expected) !== JSON.stringify(report)) {
      throw new Error(
        `Production smoke report is stale:\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(report)}`,
      );
    }
  } else {
    await mkdir(resolve(workspace, "fixtures/editor-production-smoke"), {
      recursive: true,
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (!report.mounted) throw new Error("Production editor did not mount");
  if (report.galleryEditorCodeLoaded) {
    throw new Error("Gallery loaded the editor route bundle eagerly");
  }
  if (!report.editorCodeLoaded) {
    throw new Error("Editor route did not load its editor bundle");
  }
  if (report.galleryEditorStylesLoaded) {
    throw new Error("Gallery loaded the editor stylesheet eagerly");
  }
  if (!report.editorStylesLoaded) {
    throw new Error("Editor route did not load its editor stylesheet");
  }
  if (report.galleryPdfRuntimeLoaded || report.editorPdfRuntimeLoaded) {
    throw new Error("PDF runtime loaded before a PDF export was requested");
  }
  if (report.editorLoadingScreens.length > 1) {
    throw new Error(
      `Editor revealed more than one loading screen: ${report.editorLoadingScreens.join(", ")}`,
    );
  }
  if (report.editorNetlistLayoutChangedOnLoad) {
    throw new Error(
      "The Netlist panel's code moved when its code editor loaded",
    );
  }
  if (report.editorSimulationServiceLoaded) {
    throw new Error("Editor loaded the simulation service on startup");
  }
  if (report.editorAgentRuntimeLoaded || report.editorAgentRuntimePreloaded) {
    throw new Error("Editor loaded the Agent runtime on startup");
  }
  if (!report.routePreloadBeforeStylesheets) {
    throw new Error("Route preload script waits for a stylesheet");
  }
  if (report.editorFirstLoadJsonParser) {
    throw new Error("Editor first load includes the JSON property-code parser");
  }
  if (report.editorFirstLoadRnl) {
    throw new Error("Editor first load includes @icm/rnl");
  }
  if (report.editorJsonParserLoaded) {
    throw new Error("Opening the editor loaded the JSON parser");
  }
  // Every face is WOFF2. Metropolis, which every label uses, comes from the
  // route preload; DejaVu Sans loads on demand when a symbol needs it.
  const metropolis = report.editorSchematicFonts.filter((font) =>
    font.startsWith("Metropolis-"),
  );
  const misfetched = report.editorSchematicFonts.filter(
    (font) =>
      !/\.woff2 /u.test(font) ||
      (font.startsWith("Metropolis-") && !font.endsWith(" link")),
  );
  if (metropolis.length === 0 || misfetched.length > 0) {
    throw new Error(
      `Metropolis must be preloaded WOFF2, other faces WOFF2: ${misfetched.join(", ") || "no Metropolis loaded"}`,
    );
  }
  if (report.artifactCodecWorkerBundlesModel) {
    throw new Error("The artifact codec worker bundles the circuit model");
  }
  if (report.consoleErrors.length > 0) {
    throw new Error(
      `Production smoke console errors:\n${report.consoleErrors.join("\n")}`,
    );
  }
  if (report.nodeCryptoExternalized) {
    throw new Error("node:crypto was externalized in the production build");
  }
  if (report.projectDataIsolation !== "clean") {
    throw new Error(
      `Project data found in browser caches: ${report.projectDataIsolation}`,
    );
  }
  console.log("Editor production preview smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
