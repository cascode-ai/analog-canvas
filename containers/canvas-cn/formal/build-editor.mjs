import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
const env = {
  ...process.env,
  VITE_ICM_SIMULATION_UI: "enabled",
  VITE_ICM_AGENT_UI: "enabled",
  VITE_ICM_SIMULATION_TRANSPORT: "managed",
  VITE_SIMULATION_GZIP: "1",
};
// Fixed arguments only: no caller-supplied text is evaluated by the Windows shell.
execFileSync(
  process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
  process.platform === "win32"
    ? ["/d", "/v:off", "/s", "/c", "pnpm --filter @icm/editor... build"]
    : ["--filter", "@icm/editor...", "build"],
  { cwd, env, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./verify-editor.mjs", import.meta.url))],
  { cwd, env, stdio: "inherit" },
);
