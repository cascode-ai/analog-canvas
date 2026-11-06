// Each account's circuit statistics: its public circuits with their part
// and transistor counts, and the Owner's Data tab's totals per author.

import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  type CircuitProject,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { galleryTransistorCount } from "./gallery-components";
import { refreshTransistorCounts } from "./gallery-maintenance";
import {
  ORIGIN,
  cookieHeaders,
  environment,
  makerOf,
  ownerAccountOf,
  route,
  signIn,
  submitOne,
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
      },
      {
        id: amplifier,
        name: "Amplifier",
        createdAt: expect.any(String),
        components: 4,
        transistors: 3,
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
    expect(pass.payload).toEqual({ counted: 2, remaining: 0 });
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
