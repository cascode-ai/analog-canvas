// The Sim mark (#1545): the Owner queues checks, the server runs each
// testbench again on the hosted simulator and judges it by its own Specs,
// and the mark shows only to the readers of that testbench until its
// public date.

import { afterEach, describe, expect, it } from "vitest";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json";
import { routeGalleryRequest, type GalleryRouteRuntime } from "./gallery";
import { advanceSimulationChecks } from "./gallery-simulation-check-runs";
import { dividerProjectText } from "./gallery-simulation-checks.test-support";
import {
  type Harness,
  ORIGIN,
  adminOf,
  asReader,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  seatOf,
  signIn,
  submitOne,
  testbenchProjectText,
} from "./gallery.test-support";
import {
  consumeSimulationJobs,
  type SimulationJobMessage,
} from "./simulation-operations";
import { createSimulationOperationsHarness } from "./simulation-operations.test-fixture";

/**
 * What ngspice-46 printed running the divider's prepared deck (run.cir and
 * circuit.spice, `ngspice -b run.cir`, 2026-10-09).
 */
const DIVIDER_LOG = [
  "",
  "Note: No compatibility mode selected!",
  "",
  "",
  "Circuit: divider dc",
  "",
  "Doing analysis at TEMP = 27.000000 and TNOM = 27.000000",
  "",
  "Using SPARSE 1.3 as Direct Linear Solver",
  "",
  "No. of Data Rows : 3",
  "vmid                =  5.00000e-01",
  "Note: Simulation executed from .control section ",
  "",
].join("\n");

/**
 * The hosted ngspice container: for the divider's deck it answers what
 * ngspice-46 printed for it; any other deck reports no measurement.
 */
async function ngspiceContainer(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (new URL(url).pathname === "/health")
    return Response.json({ status: "ready" });
  const run = JSON.parse(String(init?.body)) as {
    deck: string;
    files: { path: string; text: string }[];
    collection?: { rawfile: string | null };
  };
  const divider =
    run.deck.includes("meas dc vmid find v(mid) at=1") &&
    run.files.some(
      (file) =>
        file.text.includes("R1 IN MID 1k") &&
        file.text.includes("R2 MID 0 1k") &&
        file.text.includes("V1 IN 0 DC 1"),
    );
  return Response.json({
    log: divider ? DIVIDER_LOG : "No. of Data Rows : 3\n",
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    durationMs: 4,
    environment: await createSimulationEnvironmentMetadata({
      executor: "hosted-container",
      reproducibility: "pinned",
      profileId: ngspiceProfile.id,
      platform: ngspiceProfile.platform,
      simulator: {
        name: "ngspice",
        version: ngspiceProfile.simulator.version,
        binarySha256: ngspiceProfile.simulator.binarySha256,
      },
      models: {
        id: ngspiceProfile.models.id,
        contentSha256: ngspiceProfile.models.contentSha256,
      },
      startupSha256: ngspiceProfile.startup.contentSha256,
    }),
    rawfileRequested: (run.collection?.rawfile ?? null) !== null,
    ...(run.collection ? { collection: run.collection } : {}),
    truncatedOutputs: [],
  });
}

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * The Gallery with the hosted simulation behind it: the real managed-run
 * control object and routes, the ngspice route with its container, and a
 * queue that delivers each job as Cloudflare's would — or, `held`, keeps
 * them until `release`.
 */
function checkEnvironment({ held = false } = {}) {
  const gallery = environment();
  const simulation = createSimulationOperationsHarness("queue");
  closers.push(simulation.close);
  delete simulation.env.SIMULATION_PROFILE_ID;
  delete simulation.env.VACASK;
  const waiting: SimulationJobMessage[] = [];
  const deliver = async (message: SimulationJobMessage, attempt = 0) => {
    await consumeSimulationJobs(
      {
        messages: [
          {
            body: message,
            ack: () => {},
            retry: () => {
              if (attempt < 5)
                setTimeout(() => void deliver(message, attempt + 1), 0);
            },
          },
        ],
      },
      env,
      simulation.runtime,
    );
  };
  const env = Object.assign(gallery, simulation.env, {
    NGSPICE: { getByName: () => ({ fetch: ngspiceContainer }) },
    SIMULATION_JOBS: {
      async send(message: SimulationJobMessage) {
        if (held) waiting.push(message);
        else setTimeout(() => void deliver(message), 0);
      },
    },
  });
  return {
    env,
    release: () => Promise.all(waiting.splice(0).map((job) => deliver(job))),
    /** The managed runs the checks' account started. */
    runs: async () =>
      (
        (await (
          await simulation.control.fetch(
            new Request(
              "https://simulation-control/runs?ownerId=gallery-simulation-check",
            ),
          )
        ).json()) as { runs: { state: string }[] }
      ).runs,
  };
}

async function call(
  env: Harness,
  request: Request,
  runtime: GalleryRouteRuntime = {},
): Promise<Response> {
  const response = await routeGalleryRequest(asReader(request), env, runtime);
  if (!response) throw new Error("gallery route did not match");
  return response;
}

function queueChecks(
  env: Harness,
  cookie: string,
  body: unknown,
  origin = ORIGIN,
) {
  return call(
    env,
    new Request(`${ORIGIN}/api/gallery/simulation-checks`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

async function checkOf(env: Harness, id: string, cookie?: string) {
  return call(
    env,
    new Request(
      `${ORIGIN}/api/gallery/${id}/simulation-check`,
      cookie ? { headers: { Cookie: cookie } } : {},
    ),
  );
}

/** The ids carrying the Sim mark on the wall `cookie` reads, and in each entry's detail. */
async function marked(
  env: Harness,
  cookie: string | undefined,
  ids: string[],
  runtime: GalleryRouteRuntime = {},
) {
  const headers = cookie ? { Cookie: cookie } : undefined;
  const wall = (await (
    await call(
      env,
      new Request(`${ORIGIN}/api/gallery`, headers ? { headers } : {}),
      runtime,
    )
  ).json()) as { entries: { id: string; simVerified?: boolean }[] };
  const details = await Promise.all(
    ids.map(async (id) => {
      const response = await call(
        env,
        new Request(
          `${ORIGIN}/api/gallery/${id}?summary=1`,
          headers ? { headers } : {},
        ),
        runtime,
      );
      return (await response.json()) as {
        entry: { id: string; simVerified?: boolean };
      };
    }),
  );
  return {
    wall: wall.entries.filter((entry) => entry.simVerified).map((e) => e.id),
    detail: details
      .filter(({ entry }) => entry.simVerified)
      .map(({ entry }) => entry.id),
  };
}

/** A passing verdict, written as a finished check stores it. */
function seedPass(env: Harness, id: string): void {
  env.gallerySql.exec(
    "UPDATE gallery_entries SET simulation_check_json = ? WHERE id = ?",
    JSON.stringify({
      status: "pass",
      checkedAt: "2026-10-09T08:00:00.000Z",
      rule: 1,
      simulator: "ngspice ngspice-46",
      folders: [],
    }),
    id,
  );
}

describe("simulation checks", () => {
  it("are queued and read by the Owner's accounts alone", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const id = await submitOne(env, "Amplifier", {
      cookie: maker,
      text: testbenchProjectText("Amplifier"),
    });
    // An administrator who is not one of the Owner's accounts is refused.
    for (const cookie of [maker, await adminOf(env)]) {
      expect((await queueChecks(env, cookie, { ids: [id] })).status).toBe(403);
      expect(
        (
          await call(
            env,
            new Request(`${ORIGIN}/api/gallery/simulation-checks`, {
              headers: { Cookie: cookie },
            }),
          )
        ).status,
      ).toBe(403);
    }
    // The read credential carries no session.
    expect(
      (await call(env, new Request(`${ORIGIN}/api/gallery/simulation-checks`)))
        .status,
    ).toBe(401);
    const owner = await ownerAccountOf(env);
    expect(
      (
        await queueChecks(
          env,
          owner,
          { ids: [id] },
          "https://elsewhere.example",
        )
      ).status,
    ).toBe(403);
    for (const body of [
      {},
      { ids: [] },
      { all: false },
      { all: true, ids: [id] },
    ])
      expect((await queueChecks(env, owner, body)).status).toBe(400);

    const queued = await queueChecks(env, owner, { all: true });
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({
      queued: [id],
      noTestbench: [],
      missing: [],
      waiting: 1,
    });
    const progress = await call(
      env,
      new Request(`${ORIGIN}/api/gallery/simulation-checks`, {
        headers: { Cookie: owner },
      }),
    );
    expect(await progress.json()).toMatchObject({
      waiting: 1,
      current: { id, name: "Amplifier", folderIndex: 0 },
    });
  });

  it("answers an entry without a testbench no-testbench, readable by its testbench's readers alone", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const id = await submitOne(env, "Plain", {
      cookie: maker,
      text: projectText("Plain"),
    });
    const queued = await queueChecks(env, owner, { ids: [id, "unknown-1"] });
    expect(await queued.json()).toEqual({
      queued: [],
      noTestbench: [id],
      missing: ["unknown-1"],
      waiting: 0,
    });
    for (const cookie of [maker, owner]) {
      const read = await checkOf(env, id, cookie);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        check: { status: "no-testbench", reason: "no-testbench", rule: 1 },
        waiting: false,
      });
    }
    // A curator, another member and the read credential learn nothing.
    for (const cookie of [
      await adminOf(env),
      await signIn(env.authDurable, "other@example.com"),
      undefined,
    ])
      expect((await checkOf(env, id, cookie)).status).toBe(404);
  });

  it("runs each testbench on the hosted simulator: a met Spec passes, a missed one fails", async () => {
    const { env, runs } = checkEnvironment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const passing = await submitOne(env, "Divider", {
      cookie: maker,
      text: dividerProjectText("Divider", "vmid range 0.45 0.55 unit=V"),
    });
    const failing = await submitOne(env, "Divider, tight", {
      cookie: maker,
      text: dividerProjectText("Divider, tight", "vmid > 0.9 unit=V"),
    });
    expect(
      (await queueChecks(env, owner, { ids: [passing, failing] })).status,
    ).toBe(202);
    expect(await advanceSimulationChecks(env)).toBe(2);

    const read = async (id: string) =>
      ((await (await checkOf(env, id, maker)).json()) as { check: unknown })
        .check;
    expect(await read(passing)).toMatchObject({
      status: "pass",
      rule: 1,
      simulator: "ngspice ngspice-46",
      folders: [
        {
          name: "Divider DC",
          status: "pass",
          profileId: ngspiceProfile.id,
          specs: [
            {
              name: "vmid",
              expected: "[0.45, 0.55]",
              value: 0.5,
              unit: "V",
              judgment: "pass",
            },
          ],
        },
      ],
    });
    expect(await read(failing)).toMatchObject({
      status: "fail",
      reason: "outside-spec",
      folders: [
        {
          status: "fail",
          code: "outside-spec",
          specs: [
            {
              name: "vmid",
              expected: "> 0.9",
              value: 0.5,
              judgment: "failed",
              reason: "outside-spec",
            },
          ],
        },
      ],
    });
    expect(await marked(env, owner, [passing, failing])).toEqual({
      wall: [passing],
      detail: [passing],
    });
    // The Owner's progress counts each verdict apart.
    const progress = await call(
      env,
      new Request(`${ORIGIN}/api/gallery/simulation-checks`, {
        headers: { Cookie: owner },
      }),
    );
    expect(((await progress.json()) as { counts: unknown }).counts).toEqual({
      pass: 1,
      fail: 1,
      error: 0,
      noTestbench: 0,
    });
    // One managed run each, under the checks' own account.
    expect((await runs()).map((run) => run.state)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    // The queue is empty; a later pass reads it and stops.
    expect(await advanceSimulationChecks(env)).toBe(0);
  });

  it("leaves a run the simulator has not finished to the next pass, which reads that same run", async () => {
    const { env, release, runs } = checkEnvironment({ held: true });
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const id = await submitOne(env, "Divider", {
      cookie: maker,
      text: dividerProjectText("Divider", "vmid range 0.45 0.55 unit=V"),
    });
    await queueChecks(env, owner, { ids: [id] });
    expect(
      await advanceSimulationChecks(env, { budgetMs: 50, resultWaitMs: 0 }),
    ).toBe(0);
    expect((await runs()).map((run) => run.state)).toEqual(["queued"]);
    expect(await (await checkOf(env, id, owner)).json()).toEqual({
      check: null,
      waiting: true,
    });

    await release();
    expect(await advanceSimulationChecks(env)).toBe(1);
    expect((await runs()).map((run) => run.state)).toEqual(["succeeded"]);
    expect(await (await checkOf(env, id, owner)).json()).toMatchObject({
      check: { status: "pass" },
      waiting: false,
    });
  });

  it("shows the Sim mark to the Owner, the author and AI peers until its public date, then to everyone", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const claude = await seatOf(env, 0);
    const sol = await seatOf(env, 2);
    const owner = await ownerAccountOf(env);
    const other = await signIn(env.authDurable, "other@example.com");
    const curator = await adminOf(env);
    const person = await submitOne(env, "Person's divider", {
      cookie: maker,
      text: testbenchProjectText("Person's divider"),
    });
    const ai = await submitOne(env, "AI divider", {
      cookie: claude,
      text: testbenchProjectText("AI divider"),
    });
    seedPass(env, person);
    seedPass(env, ai);
    const ids = [person, ai];
    const both = { wall: [ai, person], detail: ids };

    expect(await marked(env, owner, ids)).toEqual(both);
    expect(await marked(env, maker, ids)).toEqual({
      wall: [person],
      detail: [person],
    });
    expect(await marked(env, sol, ids)).toEqual({ wall: [ai], detail: [ai] });
    for (const cookie of [other, curator, undefined])
      expect(await marked(env, cookie, ids)).toEqual({ wall: [], detail: [] });
    // A date to come keeps it private; once it has come, everyone sees it.
    const soon = { simulationMarkPublicFrom: "2999-01-01" };
    expect(await marked(env, other, ids, soon)).toEqual({
      wall: [],
      detail: [],
    });
    const since = { simulationMarkPublicFrom: "2026-01-01" };
    for (const cookie of [other, curator, undefined])
      expect(await marked(env, cookie, ids, since)).toEqual(both);
  });

  it("clears an entry's verdict once its Project or testbench changes, not its tags", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const id = await submitOne(env, "Amplifier", {
      cookie: maker,
      text: testbenchProjectText("Amplifier"),
    });
    const update = (fields: Record<string, unknown>) =>
      call(
        env,
        new Request(`${ORIGIN}/api/gallery/${id}`, {
          method: "PUT",
          headers: {
            Origin: ORIGIN,
            Cookie: maker,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Amplifier",
            description: "d",
            ...fields,
          }),
        }),
      );
    const verdict = async () =>
      (
        (await (await checkOf(env, id, owner)).json()) as {
          check: { status: string } | null;
        }
      ).check;

    seedPass(env, id);
    expect(
      (
        await update({
          projectText: testbenchProjectText("Amplifier"),
          tags: ["amplifier"],
        })
      ).status,
    ).toBe(200);
    expect(await verdict()).toMatchObject({ status: "pass" });

    // Only the testbench's Spec changes.
    expect(
      (
        await update({
          projectText: testbenchProjectText("Amplifier", "gain_db > 60"),
        })
      ).status,
    ).toBe(200);
    expect(await verdict()).toBeNull();
    expect(await marked(env, owner, [id])).toEqual({ wall: [], detail: [] });

    seedPass(env, id);
    expect(
      (await update({ projectText: projectText("Amplifier") })).status,
    ).toBe(200);
    expect(await verdict()).toBeNull();
  });
});

/** What the Owner's local check reports for the divider whose Spec it met. */
function localPass(digests: { projectDigest: string; testbenchDigest: string }) {
  return {
    projectDigest: digests.projectDigest,
    testbenchDigest: digests.testbenchDigest,
    status: "pass",
    checkedAt: "2026-11-22T09:00:00.000Z",
    folders: [
      {
        name: "Divider DC",
        status: "pass",
        simulator: "ngspice ngspice-46",
        profileId: ngspiceProfile.id,
        specs: [
          {
            name: "vmid",
            expected: "[0.45, 0.55]",
            value: 0.5,
            unit: "V",
            judgment: "pass",
          },
        ],
      },
    ],
  };
}

describe("local simulation checks", () => {
  /** An entry with a testbench, and the Owner's token for a script. */
  async function setUp() {
    const env = environment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const minted = (await (
      await env.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/owner-tokens`, {
          method: "POST",
          headers: { Origin: ORIGIN, Cookie: owner },
          body: JSON.stringify({ label: "simulation machine" }),
        }),
      )
    ).json()) as { token: string };
    const id = await submitOne(env, "Divider", {
      cookie: maker,
      text: dividerProjectText("Divider", "vmid range 0.45 0.55 unit=V"),
    });
    /** A script's request: the bearer alone; or a browser's, with `cookie`. */
    const send = (
      path: string,
      who: { token?: string; cookie?: string; origin?: string },
      body?: unknown,
    ) =>
      call(
        env,
        new Request(`${ORIGIN}${path}`, {
          ...(body === undefined
            ? {}
            : { method: "POST", body: JSON.stringify(body) }),
          headers: {
            "content-type": "application/json",
            ...(who.token ? { Authorization: `Bearer ${who.token}` } : {}),
            ...(who.cookie ? { Cookie: who.cookie } : {}),
            ...(who.origin ? { Origin: who.origin } : {}),
          },
        }),
      );
    const input = async () =>
      (await (
        await send(`/api/gallery/${id}/simulation-check/input`, {
          token: minted.token,
        })
      ).json()) as {
        projectText: string;
        projectDigest: string;
        testbenchDigest: string;
      };
    return { env, maker, owner, token: minted.token, id, send, input };
  }

  it("give the Owner alone the entries, their testbenches and digests", async () => {
    const { env, maker, token, id, send } = await setUp();
    const inputs = await send("/api/gallery/simulation-checks/inputs", {
      token,
    });
    expect(inputs.status).toBe(200);
    expect(await inputs.json()).toEqual({
      entries: [{ id, name: "Divider" }],
    });
    const input = await send(`/api/gallery/${id}/simulation-check/input`, {
      token,
    });
    expect(input.status).toBe(200);
    const read = (await input.json()) as Record<string, string>;
    expect(read).toMatchObject({
      id,
      name: "Divider",
      projectDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      testbenchDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(JSON.parse(read.projectText!).simulationFolders).toHaveLength(1);

    for (const path of [
      "/api/gallery/simulation-checks/inputs",
      `/api/gallery/${id}/simulation-check/input`,
    ]) {
      // Its author and a curator are not the Owner; nor is no one.
      for (const cookie of [maker, await adminOf(env)])
        expect((await send(path, { cookie })).status).toBe(403);
      expect((await send(path, {})).status).toBe(401);
      expect((await send(path, { token: "acot_wrong" })).status).toBe(401);
    }
    expect(
      (await send("/api/gallery/unknown-1/simulation-check/input", { token }))
        .status,
    ).toBe(404);
  });

  it("record the Owner's verdict, by token or same-origin session, private as the hosted one", async () => {
    const { env, maker, owner, token, id, send, input } = await setUp();
    const body = localPass(await input());
    const path = `/api/gallery/${id}/simulation-check`;
    expect(
      (await send(path, { cookie: maker, origin: ORIGIN }, body)).status,
    ).toBe(403);
    expect(
      (
        await send(
          path,
          { cookie: owner, origin: "https://elsewhere.example" },
          body,
        )
      ).status,
    ).toBe(403);
    expect((await send(path, {}, body)).status).toBe(401);

    const recorded = await send(path, { token }, body);
    expect(recorded.status).toBe(200);
    expect(await recorded.json()).toMatchObject({
      recorded: true,
      check: {
        status: "pass",
        rule: 1,
        origin: "local",
        simulator: "ngspice ngspice-46",
        checkedAt: "2026-11-22T09:00:00.000Z",
      },
    });
    expect(
      (await send(path, { cookie: owner, origin: ORIGIN }, body)).status,
    ).toBe(200);
    expect(await (await checkOf(env, id, maker)).json()).toMatchObject({
      check: { status: "pass", origin: "local" },
    });
    // The mark keeps the hosted one's readers until its public date.
    expect(await marked(env, owner, [id])).toEqual({
      wall: [id],
      detail: [id],
    });
    for (const cookie of [
      await adminOf(env),
      await signIn(env.authDurable, "other@example.com"),
      undefined,
    ])
      expect(await marked(env, cookie, [id])).toEqual({ wall: [], detail: [] });
  });

  it("refuse a verdict that does not speak for what is stored", async () => {
    const { env, maker, token, id, send, input } = await setUp();
    const path = `/api/gallery/${id}/simulation-check`;
    const pass = localPass(await input());
    const spec = pass.folders[0]!.specs[0]!;
    const refusal = async (body: unknown) => {
      const response = await send(path, { token }, body);
      return [
        response.status,
        ((await response.json()) as { error?: string }).error,
      ];
    };

    expect(await refusal({ ...pass, projectDigest: "0".repeat(64) })).toEqual(
      [409, "stale-content"],
    );
    expect(await refusal({ ...pass, testbenchDigest: "x" })).toEqual([
      400,
      "invalid-fields",
    ]);
    // A status its folders do not give, another testbench's folder, a
    // passing folder with a missed Spec, a check from the future.
    expect(await refusal({ ...pass, status: "fail" })).toEqual([
      400,
      "inconsistent-verdict",
    ]);
    expect(
      await refusal({
        ...pass,
        folders: [{ ...pass.folders[0], name: "Another folder" }],
      }),
    ).toEqual([400, "folders-mismatch"]);
    expect(
      await refusal({
        ...pass,
        folders: [
          { ...pass.folders[0], specs: [{ ...spec, judgment: "failed" }] },
        ],
      }),
    ).toEqual([400, "invalid-fields"]);
    expect(
      await refusal({ ...pass, checkedAt: "2999-01-01T00:00:00Z" }),
    ).toEqual([400, "invalid-fields"]);
    // A missed Spec is a verdict like any other.
    expect(
      await refusal({
        ...pass,
        status: "fail",
        folders: [
          {
            ...pass.folders[0],
            status: "fail",
            code: "outside-spec",
            specs: [{ ...spec, judgment: "failed", reason: "outside-spec" }],
          },
        ],
      }),
    ).toEqual([200, undefined]);

    // An edit since the check was read: refused, and the mark it had is gone.
    expect((await send(path, { token }, pass)).status).toBe(200);
    const edited = await call(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: maker,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Divider",
          description: "d",
          projectText: dividerProjectText("Divider", "vmid > 0.4 unit=V"),
        }),
      }),
    );
    expect(edited.status).toBe(200);
    expect(
      ((await (await checkOf(env, id, maker)).json()) as { check: unknown })
        .check,
    ).toBeNull();
    expect(await refusal(pass)).toEqual([409, "stale-content"]);

    // No testbench, nothing to record.
    const plain = await submitOne(env, "Plain", {
      cookie: maker,
      text: projectText("Plain"),
    });
    const plainInput = (await (
      await send(`/api/gallery/${plain}/simulation-check/input`, { token })
    ).json()) as { projectDigest: string; testbenchDigest: string | null };
    expect(plainInput.testbenchDigest).toBeNull();
    const none = await send(
      `/api/gallery/${plain}/simulation-check`,
      { token },
      {
        ...pass,
        projectDigest: plainInput.projectDigest,
        testbenchDigest: "0".repeat(64),
      },
    );
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "no-testbench" });
  });
});
