import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const { startLocalHost } = await import(
  `../output/release/interactive-circuit-maker-v${version}/host/index.js`
);

const releaseRoot = resolve(
  `output/release/interactive-circuit-maker-v${version}`,
);
const metadata = JSON.parse(
  await readFile(resolve(releaseRoot, "release.json"), "utf8"),
);
if (metadata.version !== version)
  throw new Error("Release metadata version mismatch");
const running = await startLocalHost({
  editorRoot: resolve(releaseRoot, "editor"),
});
try {
  const [health, manifest, serviceWorker, index] = await Promise.all([
    fetch(`${running.origin}/healthz`),
    fetch(`${running.origin}/manifest.webmanifest`),
    fetch(`${running.origin}/sw.js`),
    fetch(running.origin),
  ]);
  if (!health.ok || (await health.json()).version !== version)
    throw new Error("Release health check failed");
  const manifestData = await manifest.json();
  if (manifestData.icons.length < 2 || manifestData.display !== "standalone")
    throw new Error("PWA manifest is incomplete");
  const serviceWorkerSource = await serviceWorker.text();
  if (
    !serviceWorker.ok ||
    serviceWorker.headers.get("content-type") !==
      "text/javascript; charset=utf-8" ||
    serviceWorker.headers.get("cache-control") !== "no-cache" ||
    !serviceWorkerSource.includes('self.addEventListener("install"') ||
    !serviceWorkerSource.includes("caches.open(")
  )
    throw new Error("Service worker shell contract is incomplete");
  if (!index.ok || !(await index.text()).includes("Analog Canvas"))
    throw new Error("Editor shell is missing");
  process.stdout.write(`Release smoke passed at ${running.origin}.\n`);
} finally {
  await running.close();
}
