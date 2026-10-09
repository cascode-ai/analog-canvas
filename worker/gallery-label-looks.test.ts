// Label-look maintenance: stored labels brought to the standard looks.

import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createRoutePath,
  flattenRichText,
  hasItalicScripts,
  labelLookChanges,
  roleLabelFormat,
  type RichTextDocument,
  type RichTextRun,
} from "@icm/model";
import { diagnoseLabelClearance, diagnoseVisualQuality } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  route,
  submitOne,
} from "./gallery.test-support";

/** One drawing whose device and supply labels have no format of their own. */
/**
 * An older drawing: it never chose a subscript slant, one Net is named V_b,
 * and another label's subscript took the surrounding italic along.
 */
function legacyLabelLookProjectText(): string {
  const project = parseProject(labelLookProjectText());
  const document = project.documents[0]!;
  delete document.presentation.labelSubscriptItalic;
  const italic = (
    value: string,
    ...styles: ("bold" | "subscript")[]
  ): RichTextRun => ({
    kind: "span",
    style: "italic",
    children: [
      styles.reduceRight<RichTextRun>(
        (child, style) => ({ kind: "span", style, children: [child] }),
        { kind: "text", value },
      ),
    ],
  });
  const labels: [string, string, RichTextDocument | undefined][] = [
    ["b", "V_b", undefined],
    [
      "in",
      "VIN",
      {
        runs: [
          italic("V", "bold"),
          {
            kind: "span",
            style: "subscript",
            children: [italic("IN", "bold")],
          },
        ],
      },
    ],
  ];
  for (const [id, name, formatOverride] of labels) {
    document.nets.push({ id: `net-${id}`, terminals: [] });
    document.connectivityEvidence.push({
      id: `claim-${id}`,
      kind: "name-claim",
      netId: `net-${id}`,
      name,
      scope: "local",
      owner: { kind: "net-label", annotationId: `net-label-${id}` },
    });
    document.annotations.push({
      id: `net-label-${id}`,
      kind: "net-label",
      binding: { kind: "net-name", netId: `net-${id}` },
      netId: `net-${id}`,
      ...(formatOverride ? { formatOverride } : {}),
      anchor: { kind: "free", position: { x: 300, y: id === "b" ? 100 : 160 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
  }
  return serializeProject(project);
}

/**
 * A free "VIN" label just above a wire: its plain text clears the wire, and
 * the standard look (V with the subscript IN) reaches down onto it. The
 * height is searched with the real clearance reading, not assumed.
 */
function crowdedLabelProjectText(obstacle: "wire" | "label" = "wire"): string {
  const at = (y: number) => {
    const project = createEmptyProject("crowded", "Crowded");
    const document = project.documents[0]!;
    document.nets.push(
      { id: "net-w", terminals: [] },
      { id: "net-in", terminals: [] },
    );
    if (obstacle === "wire") {
      document.junctions.push(
        { id: "j-a", netId: "net-w", position: { x: 200, y: 100 } },
        { id: "j-b", netId: "net-w", position: { x: 400, y: 100 } },
      );
      document.routes.push(
        createRoutePath({
          id: "wire",
          netId: "net-w",
          start: { kind: "junction", junctionId: "j-a" },
          end: { kind: "junction", junctionId: "j-b" },
          bends: [],
          modes: ["manual"],
        }),
      );
    } else {
      // A label with a look of its own, which the maintenance never restyles.
      document.connectivityEvidence.push({
        id: "claim-b",
        kind: "name-claim",
        netId: "net-w",
        name: "VB",
        scope: "local",
        owner: { kind: "net-label", annotationId: "net-label-below" },
      });
      document.annotations.push({
        id: "net-label-below",
        kind: "net-label",
        binding: { kind: "net-name", netId: "net-w" },
        netId: "net-w",
        formatOverride: { runs: [{ kind: "text", value: "VB" }] },
        anchor: { kind: "free", position: { x: 300, y: 100 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
    }
    document.connectivityEvidence.push({
      id: "claim-in",
      kind: "name-claim",
      netId: "net-in",
      name: "VIN",
      scope: "local",
      owner: { kind: "net-label", annotationId: "net-label-crowd" },
    });
    document.annotations.push({
      id: "net-label-crowd",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net-in" },
      netId: "net-in",
      anchor: { kind: "free", position: { x: 300, y } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    return project;
  };
  const crowds = (project: ReturnType<typeof at>) => {
    const document = project.documents[0]!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    return [
      ...diagnoseLabelClearance(document, resolver),
      ...diagnoseVisualQuality(document, resolver, {
        minimumSegmentLength: document.presentation.grid,
      }),
    ].some(
      (item) =>
        (item.code === "VISUAL_LABEL_CLEARANCE" ||
          item.code === "VISUAL_LABEL_OVERLAP") &&
        item.objectIds.includes("net-label-crowd"),
    );
  };
  // Positions are whole units in a saved Project.
  for (let y = 70; y <= 100; y += 1) {
    const project = at(y);
    const document = project.documents[0]!;
    const change = labelLookChanges(document).labels.find(
      (label) => label.annotationId === "net-label-crowd",
    );
    if (!change || crowds(project)) continue;
    document.annotations.find(
      (item) => item.id === "net-label-crowd",
    )!.formatOverride = change.format;
    if (crowds(project)) return serializeProject(at(y));
  }
  throw new Error(
    `No height where only the standard look reaches the ${obstacle}`,
  );
}

function labelLookProjectText(): string {
  const project = createEmptyProject("label-looks", "Label looks");
  const document = project.documents[0]!;
  document.instances.push(
    {
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    },
    {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: { position: { x: 100, y: 40 }, rotation: 0, mirror: "none" },
    },
  );
  document.nets.push({
    id: "net-vdd",
    terminals: [{ instanceId: "VDD1", pinName: "P" }],
  });
  document.connectivityEvidence.push({
    id: "claim-vdd1",
    kind: "name-claim",
    netId: "net-vdd",
    name: "VDD",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: "VDD1" },
  });
  document.annotations.push(
    {
      id: "instance-label-M1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 20, y: 0 },
        fallbackPosition: { x: 120, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
    {
      id: "power-label-vdd1",
      kind: "power-label",
      binding: { kind: "net-name", netId: "net-vdd" },
      netId: "net-vdd",
      anchor: {
        kind: "object",
        objectId: "VDD1",
        localOffset: { x: 20, y: 10 },
        fallbackPosition: { x: 120, y: 50 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  );
  return serializeProject(project);
}

describe("label-look maintenance", () => {
  const endpoint = `${ORIGIN}/api/gallery/maintenance/label-looks`;
  const entryRow = (env: Harness, id: string) =>
    env.gallerySql
      .exec<Record<string, any>>(
        "SELECT * FROM gallery_entries WHERE id = ?",
        id,
      )
      .one();
  const versionCount = (env: Harness, id: string) =>
    env.gallerySql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM gallery_entry_versions WHERE entry_id = ?",
        id,
      )
      .one().n;

  it("previews, then applies stored standard looks without touching names or history", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Label looks", {
      cookie,
      text: labelLookProjectText(),
    });
    const send = (body: unknown, headers = cookieHeaders(cookie)) =>
      route(
        env,
        new Request(endpoint, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await send({ ids: [id] }, { Origin: ORIGIN })).status).toBe(401);
    expect(
      (
        await send(
          { ids: [id] },
          { ...cookieHeaders(cookie), Origin: "https://untrusted.example" },
        )
      ).status,
    ).toBe(403);
    expect((await send({ ids: [] })).status).toBe(400);

    const before = entryRow(env, id);
    const versions = versionCount(env, id);
    const preview = (await (await send({ ids: [id] })).json()) as {
      results: Array<Record<string, any>>;
    };
    expect(preview.results[0]).toMatchObject({
      id,
      changed: true,
      namesUnchanged: true,
      netlistUnchanged: true,
      labels: [
        { id: "instance-label-M1", name: "M1", role: "device-reference" },
        { id: "power-label-vdd1", name: "VDD", role: "supply" },
      ],
    });
    // A preview writes nothing.
    expect(entryRow(env, id)).toEqual(before);

    // Applying requires the exact content the preview reported.
    expect(
      (await (await send({ ids: [id], apply: true })).json()).results[0],
    ).toMatchObject({ skipped: "stale" });
    const applied = (await (
      await send({
        ids: [id],
        apply: true,
        expected: { [id]: preview.results[0]!.sha },
      })
    ).json()) as { results: Array<Record<string, any>> };
    expect(applied.results[0]).toMatchObject({ applied: true });

    const after = entryRow(env, id);
    expect(after.preview_revision).not.toBe(before.preview_revision);
    expect(after.name).toBe(before.name);
    expect(after.status).toBe(before.status);
    expect(versionCount(env, id)).toBe(versions);
    const stored = parseProject(after.project_text).documents[0]!;
    expect(stored.instances.map((instance) => instance.reference)).toEqual([
      "M1",
      undefined,
    ]);
    expect(
      stored.annotations.find((item) => item.id === "instance-label-M1")
        ?.formatOverride,
    ).toEqual(roleLabelFormat("device-reference", "M1"));
    expect(
      stored.annotations.find((item) => item.id === "power-label-vdd1")
        ?.formatOverride,
    ).toEqual(roleLabelFormat("supply", "VDD"));
    // Nothing is left to change on a second pass.
    expect((await (await send({ ids: [id] })).json()).results[0]).toMatchObject(
      { changed: false, labels: [] },
    );
  });

  it("restyles a retained version in place, keeping its identity and metadata (#1211)", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Version looks", {
      cookie,
      text: labelLookProjectText(),
    });
    env.gallerySql.exec(
      `INSERT INTO gallery_entry_versions(id, entry_id, version_no, name, author,
         description, tags, schema_version, project_text, svg_text, created_at)
       VALUES ('version-1', ?, 1, 'Before', 'Earlier byline', 'Earlier text',
         ',amplifier,', ?, ?, '<svg/>', '2026-09-01T00:00:00.000Z')`,
      id,
      CURRENT_PROJECT_FILE_VERSION,
      labelLookProjectText(),
    );
    const version = () =>
      env.gallerySql
        .exec<Record<string, any>>(
          "SELECT * FROM gallery_entry_versions WHERE id = 'version-1'",
        )
        .one();
    const send = async (body: unknown) =>
      (await (
        await route(
          env,
          new Request(endpoint, {
            method: "POST",
            headers: {
              ...cookieHeaders(cookie),
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        )
      ).json()) as { results: Array<Record<string, any>> };
    const table = "galleryEntryVersions";
    const entryBefore = entryRow(env, id);
    const before = version();
    const preview = await send({ table, ids: ["version-1"] });
    expect(preview.results[0]).toMatchObject({
      id: "version-1",
      changed: true,
      namesUnchanged: true,
      netlistUnchanged: true,
      labels: [{ id: "instance-label-M1" }, { id: "power-label-vdd1" }],
    });
    expect(version()).toEqual(before);
    expect(
      (await send({ table, ids: ["version-1"], apply: true })).results[0],
    ).toMatchObject({ skipped: "stale" });
    expect(
      (
        await send({
          table,
          ids: ["version-1"],
          apply: true,
          expected: { "version-1": preview.results[0]!.sha },
        })
      ).results[0],
    ).toMatchObject({ applied: true });
    const after = version();
    const { project_text: _text, svg_text: _svg, ...identity } = after;
    const { project_text: _was, svg_text: _wasSvg, ...was } = before;
    expect(identity).toEqual(was);
    expect(after.svg_text).not.toBe("<svg/>");
    expect(
      parseProject(after.project_text).documents[0]!.annotations.find(
        (item) => item.id === "instance-label-M1",
      )?.formatOverride,
    ).toEqual(roleLabelFormat("device-reference", "M1"));
    // The entry the version belongs to is not touched.
    expect(entryRow(env, id)).toEqual(entryBefore);
    expect(
      (await send({ table, ids: ["version-1"] })).results[0],
    ).toMatchObject({ changed: false, labels: [] });
    const unknown = await route(
      env,
      new Request(endpoint, {
        method: "POST",
        headers: {
          ...cookieHeaders(cookie),
          "content-type": "application/json",
        },
        body: JSON.stringify({ table: "galleryLikes", ids: [id] }),
      }),
    );
    expect(unknown.status).toBe(400);
    // The restyled version stays restorable, and restores as restyled.
    const restored = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}/versions/version-1/restore`, {
        method: "POST",
        headers: cookieHeaders(cookie),
      }),
    );
    expect(restored.status).toBe(200);
    expect(
      parseProject(
        entryRow(env, id).project_text,
      ).documents[0]!.annotations.find(
        (item) => item.id === "instance-label-M1",
      )?.formatOverride,
    ).toEqual(roleLabelFormat("device-reference", "M1"));
  });

  it("leaves a label's look when its standard look would reach a wire it cleared", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Crowded label", {
      cookie,
      text: crowdedLabelProjectText(),
    });
    const send = async (body: unknown) =>
      (await (
        await route(
          env,
          new Request(endpoint, {
            method: "POST",
            headers: {
              ...cookieHeaders(cookie),
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        )
      ).json()) as { results: Array<Record<string, any>> };
    const preview = (await send({ ids: [id] })).results[0]!;
    expect(preview).toMatchObject({
      clearanceKept: ["net-label-crowd"],
      labels: [],
    });
    expect(preview.changed).not.toBe(true);
    await send({
      ids: [id],
      apply: true,
      expected: { [id]: preview.sha },
    });
    expect(
      parseProject(entryRow(env, id).project_text).documents[0]!.annotations[0]!
        .formatOverride,
    ).toBeUndefined();
    // A nudge that leaves the label over the wire refuses the row.
    expect(
      (
        await send({
          ids: [id],
          nudges: { [id]: [{ label: "net-label-crowd", dx: 0, dy: 0 }] },
        })
      ).results[0],
    ).toMatchObject({ skipped: "unclear-nudge:net-label-crowd" });
    // Another label counts as a wire does.
    const overLabel = await submitOne(env, "Crowded by a label", {
      cookie,
      text: crowdedLabelProjectText("label"),
    });
    expect((await send({ ids: [overLabel] })).results[0]).toMatchObject({
      clearanceKept: ["net-label-crowd"],
      labels: [],
    });
    // A withdrawn entry is left as it is.
    env.gallerySql.exec(
      "UPDATE gallery_entries SET status = 'recycled' WHERE id = ?",
      overLabel,
    );
    expect((await send({ ids: [overLabel] })).results[0]).toMatchObject({
      skipped: "not-public",
    });
  });

  it("accepts only bounded nudges of the labels it restyles", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Label nudges", {
      cookie,
      text: labelLookProjectText(),
    });
    const send = (body: unknown) =>
      route(
        env,
        new Request(endpoint, {
          method: "POST",
          headers: {
            ...cookieHeaders(cookie),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    for (const nudge of [
      { label: "power-label-vdd1", dx: 0, dy: -40 },
      { label: "not-a-restyled-label", dx: 0, dy: -3 },
    ])
      expect(
        (await (await send({ ids: [id], nudges: { [id]: [nudge] } })).json())
          .results[0],
      ).toMatchObject({ skipped: `invalid-nudge:${nudge.label}` });
    const preview = (await (await send({ ids: [id] })).json()) as {
      results: Array<Record<string, any>>;
    };
    await send({
      ids: [id],
      apply: true,
      expected: { [id]: preview.results[0]!.sha },
      nudges: { [id]: [{ label: "power-label-vdd1", dx: 0, dy: -3 }] },
    });
    const label = parseProject(
      entryRow(env, id).project_text,
    ).documents[0]!.annotations.find((item) => item.id === "power-label-vdd1")!;
    expect(label.anchor).toMatchObject({ localOffset: { x: 20, y: 7 } });
  });

  it("leaves the labels the planner keeps exactly as they are", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Label keeps", {
      cookie,
      text: labelLookProjectText(),
    });
    const send = async (body: unknown) =>
      (await (
        await route(
          env,
          new Request(endpoint, {
            method: "POST",
            headers: {
              ...cookieHeaders(cookie),
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        )
      ).json()) as { results: Array<Record<string, any>> };
    expect(
      (await send({ ids: [id], keep: { [id]: ["not-a-standard-label"] } }))
        .results[0],
    ).toMatchObject({ skipped: "invalid-keep:not-a-standard-label" });
    const keep = { [id]: ["instance-label-M1"] };
    const preview = await send({ ids: [id], keep });
    expect(preview.results[0]).toMatchObject({
      changed: true,
      kept: 1,
      labels: [{ id: "power-label-vdd1" }],
    });
    await send({
      ids: [id],
      apply: true,
      keep,
      expected: { [id]: preview.results[0]!.sha },
    });
    const stored = parseProject(entryRow(env, id).project_text).documents[0]!;
    expect(
      stored.annotations.find((item) => item.id === "instance-label-M1")
        ?.formatOverride,
    ).toBeUndefined();
    expect(
      stored.annotations.find((item) => item.id === "power-label-vdd1")
        ?.formatOverride,
    ).toEqual(roleLabelFormat("supply", "VDD"));
  });

  it("draws subscripts upright and straightens stored slants only when asked", async () => {
    const env = environment();
    const cookie = await adminOf(env);
    const id = await submitOne(env, "Legacy looks", {
      cookie,
      text: legacyLabelLookProjectText(),
    });
    // Legacy looks are for drawings saved before the standards (#1052).
    env.gallerySql.exec(
      "UPDATE gallery_entries SET created_at = '2026-09-20T00:00:00.000Z' WHERE id = ?",
      id,
    );
    const later = await submitOne(env, "Later slant", {
      cookie,
      text: legacyLabelLookProjectText(),
    });
    const send = async (body: unknown) =>
      (await (
        await route(
          env,
          new Request(endpoint, {
            method: "POST",
            headers: {
              ...cookieHeaders(cookie),
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        )
      ).json()) as { results: Array<Record<string, any>> };
    const documentId = parseProject(entryRow(env, id).project_text)
      .documents[0]!.id;

    // By default: standard looks for unformatted labels, and the drawing's
    // own subscript default turns upright. A stored look is left alone.
    const plain = (await send({ ids: [id] })).results[0]!;
    expect(plain.uprightDocuments).toEqual([documentId]);
    expect(plain.labels.map((label: { id: string }) => label.id)).toEqual([
      "instance-label-M1",
      "power-label-vdd1",
    ]);

    const legacy = (await send({ ids: [id], legacyLooks: true })).results[0]!;
    expect(legacy.labels).toContainEqual(
      expect.objectContaining({ id: "net-label-in", kind: "upright" }),
    );
    await send({
      ids: [id],
      apply: true,
      legacyLooks: true,
      expected: { [id]: legacy.sha },
    });
    const stored = parseProject(entryRow(env, id).project_text).documents[0]!;
    expect(stored.presentation.labelSubscriptItalic).toBe(false);
    const inFormat = stored.annotations.find(
      (item) => item.id === "net-label-in",
    )?.formatOverride;
    expect(inFormat && hasItalicScripts(inFormat)).toBe(false);
    expect(inFormat && flattenRichText(inFormat)).toBe("VIN");
    expect(
      (await send({ ids: [id], legacyLooks: true })).results[0],
    ).toMatchObject({ changed: false });
    // Saved after the standards, a slanted script is the author's choice.
    const kept = (await send({ ids: [later], legacyLooks: true })).results[0]!;
    expect(kept.labels.map((label: { id: string }) => label.id)).toEqual([
      "instance-label-M1",
      "power-label-vdd1",
    ]);
    expect(kept.legacyWithheld).toBe(true);
    // An older entry updated since is dated by that update, which left a
    // version behind; the version itself carries its own, earlier date.
    const older = await submitOne(env, "Updated since", {
      cookie,
      text: legacyLabelLookProjectText(),
    });
    env.gallerySql.exec(
      "UPDATE gallery_entries SET created_at = '2026-09-20T00:00:00.000Z' WHERE id = ?",
      older,
    );
    env.gallerySql.exec(
      `INSERT INTO gallery_entry_versions(id, entry_id, version_no, name, author,
         description, tags, schema_version, project_text, svg_text, created_at)
       VALUES ('older-v1', ?, 1, 'Updated since', 'Admin', '', '', ?, ?,
         '<svg/>', '2026-10-01T00:00:00.000Z')`,
      older,
      CURRENT_PROJECT_FILE_VERSION,
      legacyLabelLookProjectText(),
    );
    expect(
      (await send({ ids: [older], legacyLooks: true })).results[0],
    ).toMatchObject({ legacyWithheld: true });
    env.gallerySql.exec(
      "UPDATE gallery_entry_versions SET created_at = '2026-09-21T00:00:00.000Z' WHERE id = 'older-v1'",
    );
    const version = (
      await send({
        table: "galleryEntryVersions",
        ids: ["older-v1"],
        legacyLooks: true,
      })
    ).results[0]!;
    expect(version).toMatchObject({ entryId: older, status: "public" });
    expect(version.labels).toContainEqual(
      expect.objectContaining({ id: "net-label-in", kind: "upright" }),
    );
  });
});
