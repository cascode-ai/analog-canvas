import { existsSync } from "node:fs";
import {
  collectChangedPaths,
  loadGateCatalog,
  planValidation,
  runGateCommand,
} from "./lib/validation-gates.mjs";
import { unitTestCommand } from "./lib/verify-pr-selection.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const index = args.indexOf("--base");
const base = index < 0 ? "origin/main" : args[index + 1];
if (!base) throw new Error("--base requires a Git ref");
const catalog = await loadGateCatalog();
const paths = collectChangedPaths(base, { ignoredPaths: catalog.ignoredPaths });
const command = unitTestCommand(
  planValidation(paths, catalog),
  paths.filter(existsSync),
);
if (command) runGateCommand({ id: "affected-unit", command }, { base });
else
  process.stdout.write(
    "No affected unit inputs; browser/environment obligations remain separate.\n",
  );
