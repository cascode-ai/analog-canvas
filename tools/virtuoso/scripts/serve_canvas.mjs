import { pathToFileURL } from "node:url";
import path from "node:path";
import { canvasUpstream } from "./canvas_upstream.mjs";

const { checkout, lock } = canvasUpstream();
const { startLocalHost } = await import(
  pathToFileURL(path.join(checkout, "apps/local-host/dist/index.js")).href
);
const server = await startLocalHost({
  editorRoot: path.join(checkout, "apps/editor/dist"),
  port: lock.port,
});
process.stdout.write(`${server.origin}\n`);
