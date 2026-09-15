import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { repairBsim4ChainRule, sha256 } from "./lib/vacask-bsim4-chainrule.mjs";

// Local trusted package only. Never overwrites the installed simulator or
// registers a model/Profile. Use --modules on the existing qualification tool.
const { values } = parseArgs({
  options: {
    package: { type: "string" },
    output: { type: "string", default: "output/vacask-models" },
  },
});
if (!values.package)
  throw Error(
    "Usage: node scripts/vacask-bsim4-build.mjs --package <unpacked VACASK package> [--output <candidate parent>]",
  );
const pkg = resolve(values.package);
const compiler = join(
  pkg,
  "bin",
  process.platform === "win32" ? "openvaf-r.exe" : "openvaf-r",
);
const sourcePath = join(pkg, "src/vacask/devices/spice/bsim4v8.va");
const original = readFileSync(sourcePath);
const patched = repairBsim4ChainRule(original.toString("utf8"));
const compilerSha256 = sha256(readFileSync(compiler));
const parent = resolve(values.output);
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, "bsim4-chainrule-"));
const modules = join(output, "modules");
cpSync(join(pkg, "lib/vacask/mod"), modules, { recursive: true });
const source = join(output, "bsim4v8.va");
writeFileSync(source, patched);
const modulePath = join(modules, "spice/bsim4v8.osdi");
const originalModuleSha256 = sha256(readFileSync(modulePath));
const args = [source, "-o", modulePath];
const build = spawnSync(compiler, args, {
  encoding: "utf8",
  timeout: 120000,
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
});
writeFileSync(
  join(output, "compile.log"),
  (build.stdout ?? "") + (build.stderr ?? ""),
);
const succeeded = !build.error && build.status === 0;
writeFileSync(
  join(output, "build.json"),
  JSON.stringify(
    {
      scope:
        "Unregistered diagnostic BSIM4 4.8.3 candidate; not SKY130/hosted qualification",
      platform: `${process.platform}/${process.arch}`,
      sourcePath,
      sourceSha256: sha256(original),
      patchedSourceSha256: sha256(patched),
      compiler,
      compilerSha256,
      args,
      originalModuleSha256,
      moduleSha256: succeeded ? sha256(readFileSync(modulePath)) : null,
      succeeded,
      exitCode: build.status,
      error: build.error?.message ?? null,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Evidence: ${output}`);
if (!succeeded)
  throw Error(
    `BSIM4 compilation failed; inspect ${join(output, "compile.log")}`,
  );
console.log(`Candidate modules: ${modules}`);
