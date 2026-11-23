/**
 * The in-browser simulator's thread (ngspice-worker-host.ts does the work).
 * The bytes are the editor build's own content-hashed assets, fetched on the
 * first run and kept by the browser's cache. A run cannot be interrupted from
 * inside; the page stops one by terminating this Worker.
 */
import wasmUrl from "./vendor/ngspice.wasm?url";
import spinit from "./vendor/spinit?raw";
import startup from "../../../../../../containers/ngspice/hosted.spiceinit?raw";
import type {
  BrowserNgspiceWorkerReply,
  BrowserNgspiceWorkerRequest,
} from "./browser-ngspice-protocol";
import { ngspiceWorkerHost } from "./ngspice-worker-host";

const modelUrls = import.meta.glob<string>("./sky130-continuous/*.spice", {
  query: "?url",
  import: "default",
  eager: true,
});
const cellUrls = import.meta.glob<string>(
  "../../../../../../containers/ngspice/cells/*.spice",
  { query: "?url", import: "default", eager: true },
);

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

async function bytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${basename(url)}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const files = (urls: Record<string, string>) =>
  Promise.all(
    Object.entries(urls).map(async ([path, url]) => ({
      name: basename(path),
      bytes: await bytes(url),
    })),
  );

const handle = ngspiceWorkerHost({
  load: async () => {
    const [wasm, models, cells] = await Promise.all([
      bytes(wasmUrl),
      files(modelUrls),
      files(cellUrls),
    ]);
    return { wasm, models, cells, spinit, startup };
  },
});
// The Worker's own scope; the program's lib is the page's DOM, not webworker.
const scope = self as unknown as {
  onmessage:
    ((event: MessageEvent<BrowserNgspiceWorkerRequest>) => void) | null;
  postMessage(message: BrowserNgspiceWorkerReply): void;
};
scope.onmessage = (event) =>
  void handle(event.data, (message) => scope.postMessage(message));
