import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import {
  environment,
  makerOf,
  adminOf,
  submitOne,
  route,
  ORIGIN,
  projectText,
  type Harness,
  testbenchProjectText,
} from "./gallery.test-support";

function edit(id: string, cookie: string, text = projectText("Edited")) {
  return new Request(`${ORIGIN}/api/gallery/${id}`, {
    method: "PUT",
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Edited",
      description: "updated",
      projectText: text,
    }),
  });
}

/** Delay only delivery across the Worker/DO boundary; routes and storage are real. */
function holdNextReplacement(env: Harness) {
  const binding = env.GALLERY;
  let release!: () => void;
  let reached!: () => void;
  const paused = new Promise<void>((done) => {
    release = done;
  });
  const arrived = new Promise<void>((done) => {
    reached = done;
  });
  let once = true;
  env.GALLERY = {
    getByName(name: string) {
      const real = binding.getByName(name);
      return {
        async fetch(input: string, init?: RequestInit) {
          if (once && new URL(input).pathname === "/replace-entry") {
            once = false;
            reached();
            await paused;
          }
          return real.fetch(input, init);
        },
      };
    },
  };
  return { arrived, release };
}

it("keeps a later moderation rejection when an earlier owner edit completes", async () => {
  const env = environment();
  const maker = await makerOf(env);
  const admin = await adminOf(env);
  const id = await submitOne(env, "Original", { cookie: maker });
  const hold = holdNextReplacement(env);
  const pending = route(env, edit(id, maker));
  await hold.arrived;
  const rejection = await route(
    env,
    new Request(`${ORIGIN}/api/gallery/${id}/reject`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: admin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "Rejected by moderator" }),
    }),
  );
  expect(rejection.status).toBe(200);
  expect(
    (await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))).status,
  ).toBe(404);
  hold.release();
  const updated = await pending;
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ status: "rejected" });
  expect(
    (await route(env, new Request(`${ORIGIN}/api/gallery/${id}`))).status,
  ).toBe(404);
});

it("keeps the latest private testbench when a delayed non-reader edit completes", async () => {
  const env = environment();
  const maker = await makerOf(env);
  const curator = await adminOf(env);
  const id = await submitOne(env, "Original", {
    cookie: maker,
    text: testbenchProjectText("Original", "gain_db > 40"),
  });
  const hold = holdNextReplacement(env);
  const pending = route(env, edit(id, curator));
  await hold.arrived;
  const latest = testbenchProjectText("Edited", "gain_db > 80");
  expect((await route(env, edit(id, maker, latest))).status).toBe(200);
  hold.release();
  expect((await pending).status).toBe(200);
  const read = async (cookie?: string) => {
    const response = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${id}`, {
        headers: cookie ? { Cookie: cookie } : {},
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { projectText: string };
    return parseProject(payload.projectText).simulationFolders;
  };
  expect(await read(maker)).toEqual(parseProject(latest).simulationFolders);
  expect(await read(curator)).toEqual([]);
  expect(await read()).toEqual([]);
});
