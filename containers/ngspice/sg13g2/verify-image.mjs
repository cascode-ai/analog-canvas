// Fail the image build before a mismatched binary/model/startup can replace a host.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

const child = spawn(process.execPath, ["/opt/harness/entrypoint.mjs"], {
  stdio: "inherit",
});
const exited = once(child, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (child.exitCode !== null)
      throw new Error("Profile identity check exited");
    try {
      const response = await fetch("http://127.0.0.1:8080/health");
      const health = await response.json();
      if (response.ok && health.status === "ready") {
        console.log(JSON.stringify(health.environment));
        ready = true;
        break;
      }
    } catch {
      /* The harness is still measuring the model tree. */
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error("Image does not match the qualified Profile");
} finally {
  child.kill("SIGTERM");
  await exited;
}
