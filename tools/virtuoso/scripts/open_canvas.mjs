#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canvasUpstream } from "./canvas_upstream.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let editor, host, origin, version;

async function isCanvasRunning() {
  try {
    const response = await fetch(`${origin}/healthz`, {
      signal: AbortSignal.timeout(1000),
    });
    const health = await response.json();
    if (!response.ok || health.status !== "ok" || health.version !== version)
      return false;
    const page = await fetch(`${origin}/editor`, {
      signal: AbortSignal.timeout(1000),
    });
    return (
      page.ok &&
      (await page.text()) ===
        (await readFile(path.join(editor, "index.html"), "utf8"))
    );
  } catch {
    return false;
  }
}

async function launch(command, args) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Local Analog Canvas requires Node.js 24 or newer");
  const { checkout, lock } = canvasUpstream();
  editor = path.join(checkout, "apps/editor/dist");
  host = path.join(checkout, "apps/local-host/dist/index.js");
  origin = `http://127.0.0.1:${lock.port}`;
  version = JSON.parse(
    await readFile(path.join(checkout, "apps/local-host/package.json"), "utf8"),
  ).version;
  await access(path.join(editor, "index.html"));
  await access(host);
  if (!(await isCanvasRunning())) {
    await launch(process.execPath, [
      path.join(root, "scripts/serve_canvas.mjs"),
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (await isCanvasRunning()) {
        ready = true;
        break;
      }
    }
    if (!ready)
      throw new Error(
        `Local Analog Canvas did not start on ${origin}; check whether the port is occupied.`,
      );
  }
  const url = `${origin}/editor`;
  if (!process.argv.includes("--no-browser")) {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
      throw new Error(
        `No graphical desktop is available. Open ${url} in a browser.`,
      );
    await launch("xdg-open", [url]);
  }
  process.stdout.write(`${url}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
