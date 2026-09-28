import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function canvasUpstream() {
  const checkout = path.resolve(root, "../..");
  const metadata = JSON.parse(
    readFileSync(path.join(checkout, "package.json"), "utf8"),
  );
  if (metadata.name !== "analog-canvas")
    throw new Error(
      "Install this tool under an Analog Canvas checkout at tools/virtuoso.",
    );
  return { checkout, lock: { port: 4175 } };
}
