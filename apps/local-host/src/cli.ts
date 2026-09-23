#!/usr/bin/env node
import { resolve } from "node:path";

import { createLocalSimulationHandler, startLocalHost } from "./index.js";

const rootArgument = process.argv.indexOf("--root");
const editorRoot = resolve(
  rootArgument >= 0 && process.argv[rootArgument + 1]
    ? process.argv[rootArgument + 1]!
    : "apps/editor/dist",
);
const simulationArgument = process.argv.indexOf("--simulation-url");
const simulationUrl =
  simulationArgument < 0 ? undefined : process.argv[simulationArgument + 1];
if (
  simulationArgument >= 0 &&
  (!simulationUrl || simulationUrl.startsWith("--"))
)
  throw new Error(
    "--simulation-url requires the native executor's explicit loopback origin.",
  );
const running = await startLocalHost({
  editorRoot,
  port: 4173,
  ...(simulationUrl
    ? { simulationHandler: createLocalSimulationHandler(simulationUrl) }
    : {}),
});
process.stdout.write(`Analog Canvas v0.9.2: ${running.origin}\n`);
