// Each account's circuit statistics: its public circuits with their part
// and transistor counts, and the Owner's Data tab's totals per author.

import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { galleryDeviceCounts } from "./gallery-components";
import {
  refreshGalleryStatistics,
  refreshTransistorCounts,
} from "./gallery-maintenance";
import {
  ORIGIN,
  cookieHeaders,
  environment,
  makerOf,
  ownerAccountOf,
  route,
  signIn,
  submitOne,
  testbenchProjectText,
} from "./gallery.test-support";

const at = (index: number) => ({
  position: { x: 40 * index, y: 0 },
  rotation: 0 as const,
  mirror: "none" as const,
});

/** `symbols` placed in a row on `project`'s top Cell, and a Ground. */
function drawn(project: CircuitProject, symbols: readonly string[]) {
  project.documents[0]!.instances.push(
    ...symbols.map((symbolId, index) => ({
      id: `P${index + 1}`,
      symbolId,
      reference: `${symbolId === "resistor" ? "R" : "M"}${index + 1}`,
      placement: at(index),
    })),
    { id: "GND1", symbolId: "ground", placement: at(symbols.length) },
  );
  return project;
}

function circuitText(name: string, symbols: readonly string[]): string {
  return serializeProject(
    drawn(createEmptyProject("gallery-stats", name), symbols),
  );
}

/** A circuit's transistors: its MOS and BJT parts. */
const galleryTransistorCount = (project: CircuitProject) => {
  const devices = galleryDeviceCounts(project);
  return (devices.nmos ?? 0) + (devices.pmos ?? 0) + (devices.bjt ?? 0);
};

describe("a Gallery circuit's transistor count", () => {
  it("counts the MOS and BJT parts drawn, not other parts or tray parts", () => {
    const project = drawn(createEmptyProject("flat", "Flat"), [
      "nmos",
      "pmos",
      "npn",
      "resistor",
      "capacitor",
    ]);
    project.documents[0]!.instances.push({
      id: "TRAY",
      symbolId: "nmos",
      reference: "M9",
      placement: null,
    });
    expect(galleryTransistorCount(project)).toBe(3);
  });

  it("counts a Cell's transistors once per call, and a Cell that calls itself once", () => {
    const project = drawn(createEmptyProject("tree", "Tree"), ["nmos"]);
    const inverter = createEmptyDocument("inv", "inv");
    drawn({ ...project, documents: [inverter] } as CircuitProject, [
      "nmos",
      "pmos",
    ]);
    // A Cell bound into itself must not hang the count.
    inverter.instances.push({
      id: "SELF",
      symbolId: "inverter",
      reference: "X9",
      placement: at(9),
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "inv" },
        parameters: {},
      },
    });
    project.documents.push(inverter);
    for (const id of ["XA", "XB"])
      project.documents[0]!.instances.push({
        id,
        symbolId: "inverter",
        reference: id,
        placement: at(5),
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: "inv" },
          parameters: {},
        },
      });
    // An inverter with its behavioral body holds no transistors.
    project.documents[0]!.instances.push({
      id: "XC",
      symbolId: "inverter",
      reference: "XC",
      placement: at(6),
    });
    expect(galleryTransistorCount(project)).toBe(1 + 2 * 2);
  });
});

describe("a Gallery circuit's devices", () => {
  it("sorts the parts drawn by kind, a block once and markers not at all", () => {
    const project = drawn(createEmptyProject("kinds", "Kinds"), [
      "nmos",
      "nmos",
      "pmos",
      "pnp",
      "resistor",
      "capacitor",
      "voltage-source",
      "opamp",
      "port",
    ]);
    expect(galleryDeviceCounts(project)).toEqual({
      nmos: 2,
      pmos: 1,
      bjt: 1,
      resistor: 1,
      capacitor: 1,
      source: 1,
      block: 1,
    });
  });

  it("counts a bound Cell's devices, not the block that calls it", () => {
    const project = drawn(createEmptyProject("bound", "Bound"), ["resistor"]);
    const inverter = createEmptyDocument("inv", "inv");
    drawn({ ...project, documents: [inverter] } as CircuitProject, [
      "nmos",
      "pmos",
    ]);
    project.documents.push(inverter);
    project.documents[0]!.instances.push({
      id: "XA",
      symbolId: "inverter",
      reference: "XA",
      placement: at(5),
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "inv" },
        parameters: {},
      },
    });
    expect(galleryDeviceCounts(project)).toEqual({
      resistor: 1,
      nmos: 1,
      pmos: 1,
    });
  });
});

describe("the Gallery's statistics", () => {
  it("gives every signed-in account the whole Gallery's distributions", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const other = await signIn(env.authDurable, "other@example.com");
    const amplifier = await submitOne(env, "Amplifier", {
      cookie: maker,
      text: circuitText("Amplifier", ["nmos", "nmos", "pmos", "resistor"]),
    });
    const divider = await submitOne(env, "Divider", {
      cookie: maker,
      text: circuitText("Divider", ["resistor", "resistor"]),
      ip: "203.0.113.51",
    });
    await submitOne(env, "Mirror", {
      cookie: other,
      text: circuitText("Mirror", ["npn", "npn"]),
      ip: "203.0.113.52",
    });
    env.gallerySql.exec(
      "UPDATE gallery_entries SET tags = ',ota,amplifier,cmos,', ai_generated = 1 WHERE id = ?",
      amplifier,
    );
    env.gallerySql.exec(
      "UPDATE gallery_entries SET tags = ',cmos,' WHERE id = ?",
      divider,
    );
    const read = (path: string, cookie?: string) =>
      route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/${path}`,
          cookie ? { headers: cookieHeaders(cookie) } : {},
        ),
      );
    expect((await read("stats")).status).toBe(401);
    // The scheduled pass counts the circuits and the figures ahead.
    await refreshGalleryStatistics(env, 100);
    const response = await read("stats", other);
    expect(response.status).toBe(200);
    const { summary, topAuthors } = (await response.json()) as any;
    expect(summary).toMatchObject({
      circuits: 3,
      authors: 2,
      components: 8,
      transistors: 5,
      counted: 3,
      ai: 1,
      likes: 0,
      types: [
        { type: null, circuits: 2 },
        { type: "Amplifiers", circuits: 1 },
      ],
      tags: [
        { tag: "cmos", circuits: 2 },
        { tag: "amplifier", circuits: 1 },
        { tag: "ota", circuits: 1 },
      ],
      sizes: [
        { key: "0-5", circuits: 3 },
        { key: "6-10", circuits: 0 },
        { key: "11-15", circuits: 0 },
        { key: "16-25", circuits: 0 },
        { key: "26-", circuits: 0 },
      ],
      transistorBins: [
        { key: "0", circuits: 1 },
        { key: "1-5", circuits: 2 },
        { key: "6-10", circuits: 0 },
        { key: "11-20", circuits: 0 },
        { key: "21-50", circuits: 0 },
        { key: "51-", circuits: 0 },
      ],
    });
    expect(
      Object.fromEntries(
        summary.devices
          .filter((device: any) => device.count > 0)
          .map((device: any) => [device.kind, device.count]),
      ),
    ).toEqual({ nmos: 2, pmos: 1, bjt: 2, resistor: 3 });
    // Sixteen weeks, this one last, by people and by AI.
    expect(summary.weeks).toHaveLength(16);
    expect(summary.weeks.at(-1)).toMatchObject({ human: 2, ai: 1 });
    expect(topAuthors.map((author: any) => author.circuits)).toEqual([2, 1]);

    // A read answers the kept figures; a new circuit joins them once the
    // next pass has counted it.
    await submitOne(env, "Later", {
      cookie: maker,
      text: circuitText("Later", ["nmos"]),
      ip: "203.0.113.53",
    });
    const circuits = async () =>
      ((await (await read("stats", other)).json()) as any).summary.circuits;
    expect(await circuits()).toBe(3);
    await refreshGalleryStatistics(env, 100);
    expect(await circuits()).toBe(4);

    // An author's own statistics carry their distributions and place.
    const mine = (await (await read("mine/stats", other)).json()) as any;
    expect(mine.summary).toMatchObject({ circuits: 1, transistors: 2 });
    expect(mine.rank).toEqual({ position: 2, authors: 2 });
  });

  it("marks the circuits that carry a testbench, for their Sim badge", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const simulated = await submitOne(env, "Simulated", {
      cookie: maker,
      text: testbenchProjectText("Simulated"),
    });
    const plain = await submitOne(env, "Plain", {
      cookie: maker,
      text: circuitText("Plain", ["nmos"]),
      ip: "203.0.113.61",
    });
    const marks = (circuits: any[]) =>
      Object.fromEntries(
        circuits.map((circuit) => [circuit.id, circuit.simulatable]),
      );
    const mine = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/mine/stats`, {
          headers: cookieHeaders(maker),
        }),
      )
    ).json()) as any;
    expect(marks(mine.circuits)).toEqual({ [simulated]: true, [plain]: false });
    const { authors } = (await (
      await route(
        env,
        new Request(`${ORIGIN}/api/gallery/owner-data`, {
          headers: cookieHeaders(owner),
        }),
      )
    ).json()) as any;
    const listed = (await (
      await route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/owner-data?author=${encodeURIComponent(authors[0].key)}`,
          { headers: cookieHeaders(owner) },
        ),
      )
    ).json()) as any;
    expect(marks(listed.circuits)).toEqual({
      [simulated]: true,
      [plain]: false,
    });
  });
});

describe("the Gallery's statistics by source", () => {
  it("counts the community, the reference datasets, or all of them", async () => {
    const env = environment();
    const owner = await ownerAccountOf(env);
    const maker = await makerOf(env);
    await submitOne(env, "Amplifier", {
      cookie: maker,
      text: circuitText("Amplifier", ["nmos", "pmos"]),
    });
    const imported = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/sources/amsnet/entries`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: owner,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entries: ["amsnet-1", "amsnet-2"].map((id) => ({
            id,
            name: id,
            tags: ["cmos"],
            projectText: circuitText(id, ["npn", "resistor"]),
          })),
        }),
      }),
    );
    expect(imported.status).toBe(200);
    await refreshGalleryStatistics(env, 100);
    const read = async (source?: string) =>
      (await (
        await route(
          env,
          new Request(
            `${ORIGIN}/api/gallery/stats${source ? `?source=${source}` : ""}`,
            { headers: cookieHeaders(maker) },
          ),
        )
      ).json()) as any;
    const all = await read();
    expect(all.summary).toMatchObject({
      circuits: 3,
      datasets: 2,
      transistors: 4,
      tags: [{ tag: "cmos", circuits: 2 }],
    });
    // A dataset's circuits are neither people's nor AI's.
    expect(all.summary.weeks.at(-1)).toEqual(
      expect.objectContaining({ human: 1, ai: 0, dataset: 2 }),
    );
    expect(all.sources).toEqual(
      expect.arrayContaining([
        { key: "community", name: "Community", circuits: 1 },
        { key: "amsnet", name: "AMS-Net", circuits: 2 },
      ]),
    );
    expect((await read("community")).summary).toMatchObject({
      circuits: 1,
      datasets: 0,
      transistors: 2,
    });
    const datasets = await read("datasets");
    expect(datasets.summary).toMatchObject({ circuits: 2, datasets: 2 });
    expect(datasets.topAuthors).toEqual([
      { author: "AMS-Net (redrawn)", circuits: 2 },
    ]);

    // The Owner's Recount counts the community's, then each dataset's that
    // holds any circuit, a stale count too, and their figures again.
    const amsnet = env.galleryStoreStates.get("source:amsnet")!.storage.sql;
    amsnet.exec("UPDATE gallery_entry_transistors SET transistors = 99");
    amsnet.exec("DELETE FROM gallery_stats_snapshot");
    expect((await read("datasets")).summary).toMatchObject({
      transistors: 198,
    });
    const recount = async (body: object) =>
      route(
        env,
        new Request(`${ORIGIN}/api/gallery/owner-data/recount`, {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            Cookie: owner,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    expect(await (await recount({})).json()).toEqual({
      counted: 1,
      remaining: 2,
      store: "amsnet",
      next: "",
    });
    expect(
      await (await recount({ store: "amsnet", after: "" })).json(),
    ).toEqual({ counted: 2, remaining: 0, store: null, next: null });
    expect((await read("datasets")).summary).toMatchObject({ transistors: 2 });
    expect((await recount({ store: "elsewhere" })).status).toBe(400);
  });
});

describe("an account's circuit statistics", () => {
  it("lists the account's own public circuits with their part and transistor counts", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const other = await signIn(env.authDurable, "other@example.com");
    const amplifier = await submitOne(env, "Amplifier", {
      cookie: maker,
      text: circuitText("Amplifier", ["nmos", "nmos", "pmos", "resistor"]),
    });
    const divider = await submitOne(env, "Divider", {
      cookie: maker,
      text: circuitText("Divider", ["resistor", "resistor"]),
      ip: "203.0.113.31",
    });
    await submitOne(env, "Someone else's", {
      cookie: other,
      text: circuitText("Someone else's", ["npn"]),
      ip: "203.0.113.32",
    });
    const stats = async (cookie?: string) =>
      route(
        env,
        new Request(
          `${ORIGIN}/api/gallery/mine/stats`,
          cookie ? { headers: cookieHeaders(cookie) } : {},
        ),
      );
    expect((await stats()).status).toBe(401);
    const response = await stats(maker);
    expect(response.status).toBe(200);
    const { circuits } = (await response.json()) as any;
    expect(circuits).toEqual([
      {
        id: divider,
        name: "Divider",
        createdAt: expect.any(String),
        components: 2,
        transistors: 0,
        aiGenerated: false,
        netlistable: expect.any(Boolean),
        simulatable: false,
      },
      {
        id: amplifier,
        name: "Amplifier",
        createdAt: expect.any(String),
        components: 4,
        transistors: 3,
        aiGenerated: false,
        netlistable: expect.any(Boolean),
        simulatable: false,
      },
    ]);

    // An edit counts the circuit again; a withdrawn circuit is not listed.
    const edited = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${amplifier}`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
          Cookie: maker,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Amplifier",
          description: "d",
          projectText: circuitText("Amplifier", ["nmos", "resistor"]),
        }),
      }),
    );
    expect(edited.status).toBe(200);
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'recycled', recycled_at = ? WHERE id = ?",
      new Date().toISOString(),
      divider,
    );
    expect(((await (await stats(maker)).json()) as any).circuits).toEqual([
      expect.objectContaining({
        id: amplifier,
        components: 2,
        transistors: 1,
      }),
    ]);
  });

  it("gives the Owner every author's totals, and counts the rest on schedule", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const first = await submitOne(env, "First", {
      cookie: maker,
      text: circuitText("First", ["nmos", "pmos"]),
    });
    await submitOne(env, "Second", {
      cookie: maker,
      text: circuitText("Second", ["npn", "resistor", "resistor"]),
      ip: "203.0.113.41",
    });
    const read = async (query = "") =>
      (await (
        await route(
          env,
          new Request(`${ORIGIN}/api/gallery/owner-data${query}`, {
            headers: cookieHeaders(owner),
          }),
        )
      ).json()) as any;
    // Nothing counted yet: the totals say how many are still to count.
    expect((await read()).authors[0]).toMatchObject({
      circuits: 2,
      components: 5,
      transistors: 0,
      transistorsPending: 2,
    });
    const pass = await refreshTransistorCounts(env);
    expect(pass.payload).toEqual({ counted: 2, remaining: 0, recounted: true });
    const [author] = (await read()).authors;
    expect(author).toMatchObject({
      circuits: 2,
      components: 5,
      transistors: 3,
      transistorsPending: 0,
    });
    // One author's circuits, each with its transistors.
    const { circuits } = await read(
      `?author=${encodeURIComponent(author.key)}`,
    );
    expect(circuits.find((item: any) => item.id === first)).toMatchObject({
      parts: 2,
      transistors: 2,
    });
    // The Owner's Recount counts every circuit again, a stale count too.
    env.gallerySql.exec(
      "UPDATE gallery_entry_transistors SET transistors = 99 WHERE entry_id = ?",
      first,
    );
    const recount = (cookie: string, origin = ORIGIN) =>
      route(
        env,
        new Request(`${ORIGIN}/api/gallery/owner-data/recount`, {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: cookie,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
    expect((await recount(maker)).status).toBe(403);
    expect((await recount(owner, "https://elsewhere.example")).status).toBe(
      403,
    );
    const recounted = await recount(owner);
    expect(await recounted.json()).toEqual({
      counted: 2,
      remaining: 0,
      store: null,
      next: null,
    });
    expect((await read()).authors[0]).toMatchObject({ transistors: 3 });
    // A count whose entry is gone is dropped by the next pass.
    env.gallerySql.exec("DELETE FROM gallery_entries WHERE id = ?", first);
    await refreshTransistorCounts(env);
    expect(
      env.gallerySql
        .exec<{
          count: number;
        }>(
          "SELECT COUNT(*) AS count FROM gallery_entry_transistors WHERE entry_id = ?",
          first,
        )
        .toArray()[0]!.count,
    ).toBe(0);
  });
});
