import { routeGalleryRequest } from "./gallery";
import { AI_SEATS } from "./auth";
import { afterEach, expect, it, vi } from "vitest";
import { pair } from "./regional-resource-actions.test-support";
import {
  wiredProjectText,
  saveRequest,
  seatOf,
  signIn,
  adminOf,
  ownerAccountOf,
  ORIGIN,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

it("fixes a foreign Dataset drawing without changing its source attribution", async () => {
  const { cn, overseas, auth, loseNextReply } = await pair();
  const owner = await ownerAccountOf(auth.source),
    cnOwner = await auth.connect(owner);
  const send = (site: typeof cn, cookie: string, path: string, body: unknown) =>
    site.route(
      new Request(ORIGIN + path, {
        method: path.endsWith("entries") ? "POST" : "PUT",
        headers: {
          origin: ORIGIN,
          cookie,
          "idempotency-key": "dataset-" + site.env.RESOURCE_REGION,
        },
        body: JSON.stringify(body),
      }),
    );
  const imported = await send(
    overseas,
    owner,
    "/api/gallery/sources/analoggenie/entries",
    {
      entries: [
        {
          id: "ag-308",
          name: "Dataset original",
          projectText: wiredProjectText(),
        },
      ],
    },
  );
  expect((await imported.json()).results[0].ok).toBe(true);
  const source = overseas.env.GALLERY.getByName("source:analoggenie"),
    target = cn.env.GALLERY.getByName("source:analoggenie");
  const change = await source.fetch("https://store/resource-sync/changes", {
    method: "POST",
    body: JSON.stringify({ stream: "analoggenie", after: 0 }),
  });
  expect(
    (
      await target.fetch("https://store/resource-sync/receive", {
        method: "POST",
        body: JSON.stringify({
          stream: "analoggenie",
          envelope: await change.json(),
        }),
      })
    ).status,
  ).toBe(200);
  loseNextReply();
  expect(
    (
      await send(cn, cnOwner, "/api/gallery/ag-308", {
        projectText: wiredProjectText("Dataset repair", 300),
      })
    ).status,
  ).toBe(503);
  const changed = await send(cn, cnOwner, "/api/gallery/ag-308", {
    projectText: wiredProjectText("Dataset repair", 300),
  });
  expect(changed.status, await changed.clone().text()).toBe(200);
  expect(
    (await (await cn.call("/api/gallery/ag-308")).json()).entry,
  ).toMatchObject({
    name: "Dataset original",
    author: "AnalogGenie (redrawn)",
  });
  expect(
    (await (await overseas.call("/api/gallery/ag-308/versions")).json())
      .versions,
  ).toHaveLength(1);
});

it("sends a rejection notice at most once when a successful command reply is lost", async () => {
  const { cn, overseas, publish, auth, loseNextReply } = await pair();
  const id = await publish(overseas),
    cookie = await auth.connect(await adminOf(auth.source));
  const sent: unknown[] = [];
  auth.source.authDurable.fetchLike = (async (
    _input: unknown,
    init?: RequestInit,
  ) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "notice-1" });
  }) as typeof fetch;
  const reject = () =>
    cn.route(
      new Request(ORIGIN + `/api/gallery/${id}/reject`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": "notice-once" },
        body: JSON.stringify({ reason: "Check the topology", notify: true }),
      }),
    );
  loseNextReply();
  expect((await reject()).status).toBe(503);
  expect((await (await reject()).json()).emailed).toBe(true);
  expect(sent).toHaveLength(1);
});

it("rejects a foreign publication as an administrator and preserves its reason on replay", async () => {
  const { cn, overseas, publish, auth, loseNextReply } = await pair();
  const id = await publish(overseas),
    cookie = await auth.connect(await adminOf(auth.source));
  const reject = (key = "reject-1") =>
    cn.route(
      new Request(ORIGIN + `/api/gallery/${id}/reject`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": key },
        body: JSON.stringify({
          reason: "Needs an electrical correction",
          notify: false,
        }),
      }),
    );
  expect(
    (
      await cn.call(`/api/gallery/${id}/reject`, "POST", "not-admin", {
        reason: "No",
      })
    ).status,
  ).toBe(401);
  loseNextReply();
  expect((await reject()).status).toBe(503);
  const retried = await reject();
  expect(retried.status, await retried.clone().text()).toBe(200);
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).status).toBe(
    "rejected",
  );
  expect((await reject()).status).toBe(200);
});

it("restores a foreign retained version once and refuses an unrelated account", async () => {
  const { cn, overseas, publish, loseNextReply, auth } = await pair();
  const id = await publish(overseas);
  const body = {
    name: "A later drawing",
    description: "",
    projectText: wiredProjectText("Later"),
  };
  expect(
    (await overseas.call(`/api/gallery/${id}`, "PUT", "later-drawing", body))
      .status,
  ).toBe(200);
  const versions = await (
    await overseas.call(`/api/gallery/${id}/versions`)
  ).json();
  const version = versions.versions[0].versionId;
  const stranger = await auth.connect(
    await signIn(auth.source.authDurable, "restore-stranger@example.com"),
  );
  expect(
    (
      await cn.route(
        new Request(ORIGIN + `/api/gallery/${id}/versions/${version}/restore`, {
          method: "POST",
          headers: { origin: ORIGIN, cookie: stranger },
        }),
      )
    ).status,
  ).toBe(401);
  loseNextReply();
  expect(
    (
      await cn.call(
        `/api/gallery/${id}/versions/${version}/restore`,
        "POST",
        "restore-version",
      )
    ).status,
  ).toBe(503);
  const restored = await cn.call(
    `/api/gallery/${id}/versions/${version}/restore`,
    "POST",
    "restore-version",
  );
  expect(restored.status, await restored.clone().text()).toBe(200);
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).entry.name).toBe(
    "Regional lifecycle",
  );
  expect(
    (await (await overseas.call(`/api/gallery/${id}/versions`)).json())
      .versions,
  ).toHaveLength(2);
});

it("changes and removes a foreign reference image without repeating a lost upload", async () => {
  const { cn, overseas, publish, loseNextReply } = await pair();
  const id = await publish(cn);
  const body = {
    rights: true,
    image: {
      type: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4d8AAAAASUVORK5CYII=",
    },
  };
  loseNextReply();
  expect(
    (
      await overseas.call(
        `/api/gallery/${id}/reference`,
        "PUT",
        "reference-1",
        body,
      )
    ).status,
  ).toBe(503);
  const retried = await overseas.call(
    `/api/gallery/${id}/reference`,
    "PUT",
    "reference-1",
    body,
  );
  expect(retried.status, await retried.clone().text()).toBe(200);
  expect((await overseas.call(`/api/gallery/${id}/reference`)).status).toBe(
    200,
  );
  expect(
    (
      await overseas.call(
        `/api/gallery/${id}/reference`,
        "DELETE",
        "remove-reference",
      )
    ).status,
  ).toBe(200);
  expect((await overseas.call(`/api/gallery/${id}/reference`)).status).toBe(
    404,
  );
});

it("updates a foreign drawing once after a lost reply and exposes the committed version at the entrance", async () => {
  const { cn, overseas, publish, loseNextReply } = await pair();
  const id = await publish(overseas);
  const body = {
    name: "Updated across regions",
    description: "An owned update",
    tags: ["amplifier"],
    projectText: wiredProjectText("Updated across regions"),
  };
  loseNextReply();
  expect(
    (await cn.call(`/api/gallery/${id}`, "PUT", "drawing-1", body)).status,
  ).toBe(503);
  overseas.restart();
  const retried = await cn.call(`/api/gallery/${id}`, "PUT", "drawing-1", body);
  expect(retried.status, await retried.clone().text()).toBe(200);
  expect((await (await cn.call(`/api/gallery/${id}`)).json()).entry.name).toBe(
    "Updated across regions",
  );
  const versions = await (
    await overseas.call(`/api/gallery/${id}/versions`)
  ).json();
  expect(versions.versions).toHaveLength(1);
  expect(
    (
      await cn.call(`/api/gallery/${id}`, "PUT", "drawing-1", {
        ...body,
        name: "Changed reuse",
      })
    ).status,
  ).toBe(409);
});

it("reimports foreign Dataset items and their comparisons with per-item retry receipts", async () => {
  const { cn, overseas, auth, loseNextReply } = await pair();
  const owner = await ownerAccountOf(auth.source),
    cnOwner = await auth.connect(owner);
  const send = (
    site: typeof cn,
    cookie: string,
    kind: string,
    key: string,
    items: unknown[],
  ) =>
    site.route(
      new Request(ORIGIN + "/api/gallery/sources/analoggenie/" + kind, {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": key },
        body: JSON.stringify({ [kind]: items }),
      }),
    );
  const original = {
    id: "ag-401",
    name: "Original dataset",
    projectText: wiredProjectText(),
  };
  expect(
    (
      await (
        await send(overseas, owner, "entries", "initial-import", [original])
      ).json()
    ).results[0].ok,
  ).toBe(true);
  const changes = await overseas.env.GALLERY.getByName(
    "source:analoggenie",
  ).fetch("https://store/resource-sync/changes", {
    method: "POST",
    body: JSON.stringify({ stream: "analoggenie", after: 0 }),
  });
  await cn.env.GALLERY.getByName("source:analoggenie").fetch(
    "https://store/resource-sync/receive",
    {
      method: "POST",
      body: JSON.stringify({
        stream: "analoggenie",
        envelope: await changes.json(),
      }),
    },
  );
  const entries = [
    {
      ...original,
      name: "Reimported",
      projectText: wiredProjectText("Changed", 340),
    },
    { id: "not-a-dataset", name: "Invalid" },
  ];
  loseNextReply();
  expect(
    (await (await send(cn, cnOwner, "entries", "reimport", entries)).json())
      .results[0].ok,
  ).toBe(false);
  expect(
    (await (await send(cn, cnOwner, "entries", "reimport", entries)).json())
      .results,
  ).toMatchObject([
    { id: "ag-401", ok: true, created: false },
    { id: "not-a-dataset", ok: false, error: "invalid-id" },
  ]);
  expect((await (await cn.call("/api/gallery/ag-401")).json()).entry.name).toBe(
    "Reimported",
  );
  expect(
    (await (await overseas.call("/api/gallery/ag-401/versions")).json())
      .versions,
  ).toHaveLength(1);
  const comparison = {
    id: "ag-401",
    verdict: "match",
    sourceNetlist: "R1 in 0 1k",
    figure: {
      type: "image/png",
      data: btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47)),
    },
  };
  loseNextReply();
  expect(
    (
      await (
        await send(cn, cnOwner, "comparisons", "comparison", [comparison])
      ).json()
    ).results[0].ok,
  ).toBe(false);
  expect(
    (
      await (
        await send(cn, cnOwner, "comparisons", "comparison", [comparison])
      ).json()
    ).results[0],
  ).toMatchObject({ ok: true, created: true });
  const read = await cn.route(
    new Request(
      ORIGIN + "/api/gallery/sources/analoggenie/comparisons/ag-401",
      { headers: { cookie: cnOwner } },
    ),
  );
  expect(await read.json()).toMatchObject({ sourceNetlist: "R1 in 0 1k" });
  const mint = await auth.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/owner-tokens", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: owner },
      body: JSON.stringify({ label: "Regional import" }),
    }),
  );
  const token = await mint.json();
  const bearerImport = () =>
    cn.route(
      new Request(ORIGIN + "/api/gallery/sources/analoggenie/entries", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token.token,
          "idempotency-key": "bearer-import",
        },
        body: JSON.stringify({
          entries: [{ ...original, name: "Owner token import" }],
        }),
      }),
    );
  loseNextReply();
  expect((await (await bearerImport()).json()).results[0].ok).toBe(false);
  expect((await (await bearerImport()).json()).results[0].ok).toBe(true);
  expect((await (await cn.call("/api/gallery/ag-401")).json()).entry.name).toBe(
    "Owner token import",
  );
  expect(
    (
      await cn.route(
        new Request(ORIGIN + "/api/gallery/ag-401", {
          method: "PUT",
          headers: { authorization: "Bearer " + token.token },
          body: JSON.stringify({ projectText: wiredProjectText() }),
        }),
      )
    ).status,
  ).toBe(401);
  await auth.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/owner-tokens/" + token.id, {
      method: "DELETE",
      headers: { origin: ORIGIN, cookie: owner },
    }),
  );
  expect((await bearerImport()).status).toBe(401);
});

it("commits a foreign drawing and its local Cloud Project binding together before reporting success", async () => {
  const { cn, overseas, publish, cookie, cnCookie, loseNextReply } = await pair(
    { projects: true },
  );
  const id = await publish(overseas);
  const saved = await overseas.route(saveRequest(cookie, "Private draft"));
  expect(saved.status, await saved.clone().text()).toBe(201);
  const draft = (await saved.json()).project;
  const event = await overseas.env.GALLERY.getByName("gallery").fetch(
    "https://projects/sync-events",
    { method: "POST", body: JSON.stringify({ after: 0 }) },
  );
  for (const item of (await event.json()).events)
    expect(
      (
        await cn.route(
          new Request(ORIGIN + "/api/project-sync/events", {
            method: "POST",
            headers: { authorization: "Bearer cn-projects" },
            body: JSON.stringify({ event: item }),
          }),
        )
      ).status,
    ).toBe(200);
  const open = async (site: typeof cn) =>
    (await (await site.call("/api/projects/" + draft.id)).json()).project;
  const before = await open(cn);
  // The domestic editor changes its private draft before publishing it abroad.
  const update = await cn.route(
    new Request(ORIGIN + "/api/projects/" + draft.id, {
      method: "PUT",
      headers: {
        origin: ORIGIN,
        cookie: cnCookie,
        "if-match": before.saveToken,
      },
      body: JSON.stringify({
        name: "Domestic private draft",
        projectText: wiredProjectText("Private changed"),
      }),
    }),
  );
  expect(update.status, await update.clone().text()).toBe(200);
  const body = {
    name: "Published draft",
    description: "",
    tags: [],
    projectText: wiredProjectText("Published drawing"),
    cloudProjectId: draft.id,
    expectedGalleryEntryId: null,
  };
  loseNextReply();
  expect(
    (await cn.call("/api/gallery/" + id, "PUT", "bind-draft", body)).status,
  ).toBe(503);
  const result = await cn.call("/api/gallery/" + id, "PUT", "bind-draft", body);
  expect(result.status, await result.clone().text()).toBe(200);
  expect(await open(cn)).toMatchObject({
    name: "Domestic private draft",
    galleryEntryId: id,
  });
  expect(await open(overseas)).toMatchObject({
    name: "Domestic private draft",
    galleryEntryId: id,
  });
  expect(
    (await (await overseas.call("/api/gallery/" + id + "/versions")).json())
      .versions,
  ).toHaveLength(1);
  // Another publication intentionally moves the draft binding. The old command cannot claim its binding still exists.
  const other = await publish(overseas);
  expect(
    (
      await cn.call("/api/gallery/" + other, "PUT", "move-binding", {
        ...body,
        expectedGalleryEntryId: id,
      })
    ).status,
  ).toBe(200);
  expect(
    (await cn.call("/api/gallery/" + id, "PUT", "bind-draft", body)).status,
  ).toBe(409);
  expect(await open(cn)).toMatchObject({ galleryEntryId: other });
});

it("reports a superseded drawing instead of replaying it over a later writer edit", async () => {
  const { cn, overseas, publish, beforeNextCatchup } = await pair();
  const id = await publish(overseas);
  const body = {
    name: "First edit",
    description: "",
    projectText: wiredProjectText("First", 300),
  };
  beforeNextCatchup(async () => {
    expect(
      (
        await overseas.call("/api/gallery/" + id, "PUT", "later-edit", {
          ...body,
          name: "Later writer edit",
          projectText: wiredProjectText("Later", 400),
        })
      ).status,
    ).toBe(200);
  });
  expect(
    (await cn.call("/api/gallery/" + id, "PUT", "first-edit", body)).status,
  ).toBe(409);
  expect(
    (await cn.call("/api/gallery/" + id, "PUT", "first-edit", body)).status,
  ).toBe(409);
  expect(
    (await (await overseas.call("/api/gallery/" + id)).json()).entry.name,
  ).toBe("Later writer edit");
  expect(
    (await (await overseas.call("/api/gallery/" + id + "/versions")).json())
      .versions,
  ).toHaveLength(2);
});

it("takes over a China-written AI drawing from overseas without granting a human the same ownership", async () => {
  const { cn, overseas, auth, publish, loseNextReply } = await pair();
  const first = await seatOf(auth.source, 0),
    second = await seatOf(auth.source, 1);
  const originalActor = (await adminOf(auth.source)).replace(
    "icm_session=",
    "icm_owner_session=",
  );
  const id = await publish(
    cn,
    await auth.connect(first + "; " + originalActor),
  );
  const body = {
    name: "AI takeover",
    description: "",
    projectText: wiredProjectText("AI repaired"),
    takeOver: true,
  };
  expect(
    (await overseas.call("/api/gallery/" + id, "PUT", "human-takeover", body))
      .status,
  ).toBe(403);
  const update = () =>
    overseas.route(
      new Request(ORIGIN + "/api/gallery/" + id, {
        method: "PUT",
        headers: {
          origin: ORIGIN,
          cookie: second,
          "idempotency-key": "ai-takeover",
        },
        body: JSON.stringify(body),
      }),
    );
  loseNextReply();
  expect((await update()).status).toBe(503);
  expect((await update()).status).toBe(200);
  expect(
    (await (await overseas.call("/api/gallery/" + id)).json()).ownerUserId,
  ).toBe(AI_SEATS[1]!.userId);
  expect(
    (await (await cn.call("/api/gallery/" + id + "/versions")).json()).versions,
  ).toHaveLength(1);
});

it("resolves an uncopied Dataset publication before reimporting or adding its comparison", async () => {
  const { cn, overseas, auth } = await pair();
  const owner = await ownerAccountOf(auth.source),
    cnOwner = await auth.connect(owner);
  const send = (
    site: typeof cn,
    cookie: string,
    kind: string,
    key: string,
    item: unknown,
  ) =>
    site.route(
      new Request(ORIGIN + "/api/gallery/sources/analoggenie/" + kind, {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": key },
        body: JSON.stringify({ [kind]: [item] }),
      }),
    );
  const entry = {
    id: "ag-701",
    name: "Overseas original",
    projectText: wiredProjectText(),
  };
  expect(
    (await (await send(overseas, owner, "entries", "create-701", entry)).json())
      .results[0],
  ).toMatchObject({ ok: true, created: true });
  // No initial resource copy: the entrance must discover the existing writer.
  const comparison = {
    id: entry.id,
    verdict: "match",
    sourceNetlist: "R1 a 0 1k",
    figure: {
      type: "image/png",
      data: btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47)),
    },
  };
  expect(
    (
      await (
        await send(cn, cnOwner, "comparisons", "compare-701", comparison)
      ).json()
    ).results[0],
  ).toMatchObject({ ok: true, created: true });
  expect(
    (
      await (
        await send(cn, cnOwner, "entries", "replace-701", {
          ...entry,
          name: "Updated from China",
        })
      ).json()
    ).results[0],
  ).toMatchObject({ ok: true, created: false });
  expect(
    (await (await overseas.call("/api/gallery/ag-701")).json()).entry.name,
  ).toBe("Updated from China");
  expect(
    (await (await overseas.call("/api/gallery/ag-701/versions")).json())
      .versions,
  ).toHaveLength(1);
  const location = await cn.env.GALLERY.getByName("source:analoggenie").fetch(
    "https://store/resource-sync/location",
    {
      method: "POST",
      body: JSON.stringify({ stream: "analoggenie", id: entry.id }),
    },
  );
  expect(await location.json()).toMatchObject({
    known: true,
    origin: "overseas",
  });
});

it("gives simultaneous new Dataset imports one deterministic writer", async () => {
  const { cn, overseas, auth } = await pair();
  const owner = await ownerAccountOf(auth.source),
    cnOwner = await auth.connect(owner);
  const send = (site: typeof cn, cookie: string, name: string) =>
    site.route(
      new Request(ORIGIN + "/api/gallery/sources/analoggenie/entries", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie,
          "idempotency-key": name.replace(/ /g, "-"),
        },
        body: JSON.stringify({
          entries: [{ id: "ag-702", name, projectText: wiredProjectText() }],
        }),
      }),
    );
  const replies = await Promise.all([
    send(cn, cnOwner, "China-create"),
    send(overseas, owner, "Overseas-create"),
  ]);
  const results = await Promise.all(
    replies.map(async (response) => (await response.json()).results[0]),
  );
  expect(results.filter((result) => result.ok && result.created)).toHaveLength(
    1,
  );
  expect(results.filter((result) => result.ok && !result.created)).toHaveLength(
    1,
  );
  for (const site of [cn, overseas]) {
    const location = await site.env.GALLERY.getByName(
      "source:analoggenie",
    ).fetch("https://store/resource-sync/location", {
      method: "POST",
      body: JSON.stringify({ stream: "analoggenie", id: "ag-702" }),
    });
    expect(await location.json()).toMatchObject({
      known: true,
      origin: "overseas",
    });
  }
  expect(
    (await (await overseas.call("/api/gallery/ag-702/versions")).json())
      .versions,
  ).toHaveLength(1);
});

it("keeps a legacy China Dataset writer when overseas has not copied it", async () => {
  const { cn, overseas, auth } = await pair();
  const owner = await ownerAccountOf(auth.source),
    cnOwner = await auth.connect(owner);
  const request = (cookie: string, name: string) =>
    new Request(ORIGIN + "/api/gallery/sources/analoggenie/entries", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie,
        "idempotency-key": name.replace(/ /g, "-"),
      },
      body: JSON.stringify({
        entries: [{ id: "ag-703", name, projectText: wiredProjectText() }],
      }),
    });
  // The existing route models a record written before deterministic new-ID routing.
  const legacy = await routeGalleryRequest(
    request(cnOwner, "Legacy China"),
    cn.env,
  );
  expect((await legacy!.json()).results[0]).toMatchObject({
    ok: true,
    created: true,
  });
  const updated = await overseas.route(request(owner, "Overseas correction"));
  expect((await updated.json()).results[0]).toMatchObject({
    ok: true,
    created: false,
  });
  expect((await (await cn.call("/api/gallery/ag-703")).json()).entry.name).toBe(
    "Overseas correction",
  );
  const location = await overseas.env.GALLERY.getByName(
    "source:analoggenie",
  ).fetch("https://store/resource-sync/location", {
    method: "POST",
    body: JSON.stringify({ stream: "analoggenie", id: "ag-703" }),
  });
  expect(await location.json()).toMatchObject({ known: true, origin: "cn" });
  expect(
    (await (await cn.call("/api/gallery/ag-703/versions")).json()).versions,
  ).toHaveLength(1);
  const url =
    "https://china.test/api/resource-sync/analoggenie/location?id=ag-703";
  expect((await cn.route(new Request(url))).status).toBe(401);
  expect(
    (
      await cn.route(
        new Request(url + "&extra=1", {
          headers: { authorization: "Bearer cn-sync" },
        }),
      )
    ).status,
  ).toBe(400);
});
