import { execFileSync } from "node:child_process";
import { canvasUpstream } from "./canvas_upstream.mjs";

if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Node.js 24 or newer is required.");
const { checkout } = canvasUpstream();
execFileSync(process.env.VC_PYTHON ?? "python3", ["--version"], {
  stdio: "inherit",
});
for (const args of [
  ["install", "--frozen-lockfile"],
  ["build"],
  ["--filter", "@icm/virtuoso-tool", "test"],
])
  execFileSync("pnpm", args, { cwd: checkout, stdio: "inherit" });
