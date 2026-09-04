// What the container promises about running somebody else's SPICE, asserted
// against the harness as it actually starts: a real process, a real socket,
// and a stand-in simulator that misbehaves in the specific ways a hostile or
// merely runaway deck would. None of these need ngspice, on purpose — the
// question here is the box around the simulator, not the simulator.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const ENTRYPOINT = join(
  dirname(fileURLToPath(import.meta.url)),
  "entrypoint.mjs",
);

/** Long enough for a process start plus a deliberate deadline; not a guess. */
const SLOW_TEST_MS = 30_000;

let workspace;
let modelRoot;
const running = [];

beforeAll(async () => {
  // realpath because macOS hands out /var/folders paths that a child's
  // getcwd() reports as /private/var, and one of these tests compares the
  // run directory the simulator saw against the root it was made under.
  workspace = await realpath(await mkdtemp(join(tmpdir(), "icm-harness-")));
  // A stand-in for the model tree: the harness hashes whatever is there to
  // fingerprint the environment, and one file is enough to hash.
  modelRoot = join(workspace, "models");
  await mkdir(modelRoot, { recursive: true });
  await writeFile(join(modelRoot, "sky130.lib.spice"), "* stand-in\n", "utf8");
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

afterEach(() => {
  while (running.length > 0) running.pop()();
});

/**
 * A stand-in simulator. The harness runs it exactly as it runs ngspice —
 * `-b deck.cir`, in the run's own directory, under the run's own environment —
 * so a shell script is enough to act out a flood, a fork, or a hang.
 */
async function simulator(name, body) {
  const path = join(workspace, name);
  // Every stand-in answers the startup identity probe first, as ngspice does.
  // A simulator that does not return from `--version` is a separate failure
  // with its own bound in the harness, not the subject of these tests.
  const probe = `case "$1" in --version) echo 'ngspice-46 stand-in'; exit 0;; esac\n`;
  await writeFile(path, `#!/bin/sh\n${probe}${body}`, "utf8");
  await chmod(path, 0o755);
  return path;
}

/** Start the harness on an ephemeral port and read the port back from it. */
async function startHarness(binary, env = {}) {
  const runRoot = await realpath(await mkdtemp(join(tmpdir(), "icm-runs-")));
  const child = spawn(process.execPath, [ENTRYPOINT], {
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      NGSPICE_BIN: binary,
      SKY130_MODEL_ROOT: modelRoot,
      SIMULATION_RUN_ROOT: runRoot,
      // The file-size ceiling is set for every harness under test so the
      // shell wrapper that applies it is the path being exercised. The
      // process ceiling is not: RLIMIT_NPROC counts every process this
      // developer's account owns, and a container-sized number would refuse
      // to fork here. One test sets it deliberately.
      SIMULATION_MAX_FILE_BLOCKS: "524288",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const stop = () => child.kill("SIGKILL");
  running.push(stop);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`harness did not start: ${output}`)),
      15_000,
    );
    timer.unref();
    const read = (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/listening on (\d+)/u);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("exit", (code) =>
      reject(new Error(`harness exited with ${code}: ${output}`)),
    );
  });
  return { port, runRoot, stop };
}

function run(port, body) {
  return fetch(`http://127.0.0.1:${port}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return { status: response.status, payload: await response.json() };
}

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

describe("the run directory", () => {
  it("gives every run its own, and takes it away again", async () => {
    // The simulator reports where it was started. Two runs must not answer
    // with the same place: a shared working directory is how one author's
    // deck reads the file another author's deck wrote.
    const { port, runRoot } = await startHarness(
      await simulator("pwd.sh", "pwd\n"),
    );

    const first = await json(await run(port, { deck: "* one\n.end\n" }));
    const second = await json(await run(port, { deck: "* two\n.end\n" }));

    const firstDirectory = first.payload.log.trim();
    const secondDirectory = second.payload.log.trim();
    expect(firstDirectory).not.toBe(secondDirectory);
    expect(firstDirectory.startsWith(runRoot)).toBe(true);
    expect(secondDirectory.startsWith(runRoot)).toBe(true);
    // And nothing of either run is left behind for the next one to find.
    expect(existsSync(firstDirectory)).toBe(false);
    expect(existsSync(secondDirectory)).toBe(false);
  });

  it("hands the simulator an environment it built, not the one it inherited", async () => {
    const { port } = await startHarness(await simulator("env.sh", "env\n"), {
      ICM_HARNESS_SENTINEL: "must-not-reach-a-deck",
    });

    const { payload } = await json(await run(port, { deck: "* env\n.end\n" }));

    // A `.control` block can print its environment. Nothing the platform put
    // in this process is a simulator input, so none of it is passed on.
    expect(payload.log).not.toContain("must-not-reach-a-deck");
    expect(payload.log).toContain("LC_ALL=C");
    // HOME is the run's own directory, so the `.spiceinit` ngspice reads is
    // this run's and never a file some earlier run left in a shared home.
    expect(payload.log).toMatch(/^HOME=.*run-/mu);
  });
});

describe("the single slot", () => {
  it(
    "refuses a second run while one is in flight, and says when to come back",
    { timeout: SLOW_TEST_MS },
    async () => {
      const release = join(workspace, "release-the-blocker");
      await rm(release, { force: true });
      const { port } = await startHarness(
        await simulator(
          "blocker.sh",
          // Bounded, so a failing assertion can never leave a process
          // spinning after the harness that started it has been stopped.
          `i=0\n` +
            `while [ ! -f "${release}" ] && [ $i -lt 200 ]; do\n` +
            `  sleep 0.1\n` +
            `  i=$((i+1))\n` +
            `done\n` +
            `echo released\n`,
        ),
      );

      const first = run(port, {
        deck: "* blocking\n.end\n",
        timeoutMs: 20_000,
      });
      // Wait for the slot to actually be taken rather than for a duration:
      // /health answers during a run precisely so this is observable.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const health = await (
          await fetch(`http://127.0.0.1:${port}/health`)
        ).json();
        if (health.busy === true) break;
        await wait(50);
      }

      const second = await run(port, { deck: "* second\n.end\n" });
      expect(second.status).toBe(503);
      expect(second.headers.get("retry-after")).toBe("2");
      const refusal = await second.json();
      expect(refusal.error).toBe("simulator-busy");

      await writeFile(release, "", "utf8");
      const { status, payload } = await json(await first);
      expect(status).toBe(200);
      expect(payload.log).toContain("released");
      expect(payload.timedOut).toBe(false);

      // And the slot comes back: the guard is a slot, not a one-shot fuse.
      const third = await json(await run(port, { deck: "* third\n.end\n" }));
      expect(third.status).toBe(200);
    },
  );
});

describe("the deadline", () => {
  it(
    "kills the whole process group, not just the process it started",
    { timeout: SLOW_TEST_MS },
    async () => {
      const heartbeat = join(workspace, "grandchild-heartbeat");
      await rm(heartbeat, { force: true });
      // A deck whose `.control` block shells out leaves a grandchild behind.
      // Signalling the simulator's pid alone lets it outlive the deadline it
      // was started under, still writing, with the container's slot released.
      const { port } = await startHarness(
        await simulator(
          "forker.sh",
          `{ i=0\n` +
            `  while [ $i -lt 100 ]; do\n` +
            `    echo tick >> "${heartbeat}"\n` +
            `    sleep 0.2\n` +
            `    i=$((i+1))\n` +
            `  done; } &\n` +
            `sleep 30\n`,
        ),
      );

      const { payload } = await json(
        await run(port, { deck: "* forks\n.end\n", timeoutMs: 900 }),
      );
      expect(payload.timedOut).toBe(true);
      expect(payload.exitCode).toBe(null);

      const atDeadline = (await stat(heartbeat)).size;
      // The grandchild really was running, or this test proves nothing.
      expect(atDeadline).toBeGreaterThan(0);
      await wait(1_000);
      expect((await stat(heartbeat)).size).toBe(atDeadline);
    },
  );

  it(
    "clamps a deadline the caller asked for beyond the ceiling",
    { timeout: SLOW_TEST_MS },
    async () => {
      const { port } = await startHarness(
        await simulator("sleeper.sh", "sleep 30\n"),
        { SIMULATION_MAX_TIMEOUT_MS: "1200" },
      );

      const startedAt = Date.now();
      const { payload } = await json(
        await run(port, { deck: "* forever\n.end\n", timeoutMs: 86_400_000 }),
      );

      expect(payload.timedOut).toBe(true);
      expect(payload.limits.timeoutMs).toBe(1200);
      expect(Date.now() - startedAt).toBeLessThan(10_000);
    },
  );
});

describe("the output cap", () => {
  it("truncates past the cap and says so, rather than shortening quietly", async () => {
    const { port } = await startHarness(
      await simulator(
        "flood.sh",
        "i=0\n" +
          "while [ $i -lt 400 ]; do\n" +
          "  echo 0123456789012345678901234567890123456789\n" +
          "  i=$((i+1))\n" +
          "done\n" +
          "echo 'a diagnosis that must survive the flood' >&2\n",
      ),
      { SIMULATION_MAX_OUTPUT_BYTES: "512" },
    );

    const { payload } = await json(await run(port, { deck: "* loud\n.end\n" }));

    expect(payload.truncated).toBe(true);
    expect(payload.truncatedOutputs).toContain("log");
    expect(payload.log).toContain("output truncated by the simulation harness");
    // The cap, plus the one line that says the cap was reached.
    expect(payload.log.length).toBeLessThan(700);
    // Each stream gets its own half of the budget, so a flood on stdout
    // cannot push the line that explains the run off the end of stderr.
    expect(payload.log).toContain("a diagnosis that must survive the flood");
  });

  it("truncates an oversized rawfile and names it in the same breath", async () => {
    const { port } = await startHarness(
      await simulator(
        "bigraw.sh",
        "i=0\n" +
          "while [ $i -lt 200 ]; do\n" +
          "  echo 0123456789012345678901234567890123456789 >> out.raw\n" +
          "  i=$((i+1))\n" +
          "done\n" +
          "echo wrote\n",
      ),
      { SIMULATION_MAX_OUTPUT_BYTES: "512" },
    );

    const { payload } = await json(
      await run(port, { deck: "* big\n.save v(out)\n.end\n" }),
    );

    expect(payload.truncated).toBe(true);
    expect(payload.truncatedOutputs).toContain("rawfile");
    expect(payload.rawfileName).toBe("out.raw");
    expect(payload.rawfile.length).toBeLessThanOrEqual(512);
  });
});

describe("the rawfile", () => {
  it("comes back as text when the deck asked for one", async () => {
    const { port } = await startHarness(
      await simulator(
        "writer.sh",
        "printf 'Title: divider\\nPlotname: op\\nValues:\\n0\\t0.5\\n' > out.raw\n" +
          "echo analysis done\n",
      ),
    );

    const { payload } = await json(
      await run(port, { deck: "* op\n.save v(out)\n.end\n" }),
    );

    expect(payload.rawfileName).toBe("out.raw");
    expect(payload.rawfileFormat).toBe("ascii");
    expect(payload.rawfile).toContain("Plotname: op");
    // Read, not parsed: turning vectors into results is a separate contract.
    expect(payload.truncated).toBe(false);
  });

  it("stays out of the answer when the deck never asked for one", async () => {
    const { port } = await startHarness(
      await simulator("stray.sh", "echo scratch > leftover.txt\necho done\n"),
    );

    const { payload } = await json(await run(port, { deck: "* op\n.end\n" }));

    expect(payload.rawfile).toBe(null);
    expect(payload.rawfileName).toBe(null);
  });
});

describe("the access token", () => {
  it("is not asked for when none is configured", async () => {
    const binary = await simulator("quiet.sh", "echo ok\n");
    const { port } = await startHarness(binary);
    const { status } = await json(await run(port, { deck: "x\n.end\n" }));
    expect(status).toBe(200);
  });

  it("guards /run and only /run once configured", async () => {
    const binary = await simulator("quiet.sh", "echo ok\n");
    const { port } = await startHarness(binary, {
      SIMULATION_ACCESS_TOKEN: "s3cret-token",
    });
    const bare = await run(port, { deck: "x\n.end\n" });
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toBe("Bearer");
    expect(await bare.json()).toEqual({ error: "unauthorized" });

    const wrong = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer s3cret-tokeN",
      },
      body: JSON.stringify({ deck: "x\n.end\n" }),
    });
    expect(wrong.status).toBe(401);

    const right = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer s3cret-token",
      },
      body: JSON.stringify({ deck: "x\n.end\n" }),
    });
    expect(right.status).toBe(200);

    // Health is the one door left open: it names the image, not a circuit.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
  });
});

describe("health", () => {
  it("reports the environment and the limits it enforces", async () => {
    const { port } = await startHarness(
      await simulator("v.sh", "echo ngspice-46\n"),
    );

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ready");
    expect(payload.busy).toBe(false);
    expect(payload.limits.concurrentRuns).toBe(1);
    expect(payload.limits.outputBytes).toBeGreaterThan(0);
    expect(payload.environment.executor).toBe("hosted-container");
    expect(payload.environment.simulator.name).toBe("ngspice");
    expect(payload.environment.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("refuses to call itself ready when the models are not there", async () => {
    const { port } = await startHarness(await simulator("v2.sh", "echo hi\n"), {
      SKY130_MODEL_ROOT: join(workspace, "no-such-model-tree"),
    });

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("not-ready");
  });
});

describe("a run root that cannot be written", () => {
  it(
    "says so, and does not keep the slot it took",
    { timeout: SLOW_TEST_MS },
    async () => {
      // The failure that took the preview simulator down on 2026-09-04. The
      // slot was taken before the run directory was made and given back only
      // by the path that made it, so one container whose run root was not
      // writable answered a single 500 and then refused every later request
      // as busy — forever, or until it slept. The run root here is a FILE, so
      // neither it nor a fallback under it can hold a directory.
      const notADirectory = join(workspace, "run-root-that-is-a-file");
      await writeFile(notADirectory, "", "utf8");
      const { port } = await startHarness(
        await simulator("quick.sh", "echo ran\n"),
        {
          SIMULATION_RUN_ROOT: notADirectory,
          // Without this the probe falls back to the platform's temporary
          // directory, which works, and there is no failure to observe.
          TMPDIR: notADirectory,
        },
      );

      const first = await json(await run(port, { deck: "* one\n.end\n" }));
      expect(first.status).toBe(500);
      expect(first.payload.error).toBe("run-directory-unavailable");

      // The slot is the point: a second request must be refused for its own
      // reasons, not because the first one never gave the slot back.
      const second = await json(await run(port, { deck: "* two\n.end\n" }));
      expect(second.status).toBe(500);
      expect(second.payload.error).toBe("run-directory-unavailable");
      expect(
        (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).busy,
      ).toBe(false);
    },
  );

  it("falls back to the platform temporary directory and says which", async () => {
    const missing = join(workspace, "no-such-run-root", "deeper");
    const { port } = await startHarness(await simulator("quick2.sh", "pwd\n"), {
      SIMULATION_RUN_ROOT: missing,
    });

    // A run root the image named but the runtime did not provide is made if
    // it can be, so this one is used rather than the fallback.
    const health = await (
      await fetch(`http://127.0.0.1:${port}/health`)
    ).json();
    expect(health.status).toBe("ready");
    expect(health.runRoot).toBe(missing);
    const { payload } = await json(await run(port, { deck: "* one\n.end\n" }));
    expect(payload.log.trim().startsWith(missing)).toBe(true);
  });
});

describe("the kernel limits", () => {
  it("runs the deck under the limits the image sets", async () => {
    const { port } = await startHarness(
      await simulator("limits.sh", "ulimit -f\necho ran\n"),
      { SIMULATION_MAX_PROCESSES: "4096", SIMULATION_MAX_FILE_BLOCKS: "1024" },
    );

    const { payload } = await json(
      await run(port, { deck: "* limited\n.end\n" }),
    );

    expect(payload.log).toContain("ran");
    expect(payload.log).toContain("1024");
    expect(payload.limits.maxFileBlocks).toBe(1024);
    expect(payload.limits.maxProcesses).toBe(4096);
  });
});
