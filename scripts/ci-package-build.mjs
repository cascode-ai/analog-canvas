import {
  buildRemainingPackages,
  producePackageBuild,
  verifyPackageBuild,
} from "./lib/ci-package-build.mjs";

const commands = {
  build: producePackageBuild,
  verify: verifyPackageBuild,
  remaining: buildRemainingPackages,
};
const command = commands[process.argv[2]];
if (!command)
  throw new Error("Usage: ci-package-build.mjs build|verify|remaining");
command(process.cwd());
