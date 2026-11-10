// @vitest-environment jsdom
// Pages that know their reader is signed out ask nothing that needs an
// account and say so at once (#2163).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ReviewPage } from "./review-page";
import { ShelfWall } from "./shelf-wall";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let requests: string[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  requests = [];
  // The Worker's answers to a signed-out reader: who is signed in (no one),
  // and 401 for anything that needs an account.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requests.push(String(input));
      if (String(input) === "/api/auth/me")
        return Response.json({ user: null });
      if (String(input) === "/api/auth/providers")
        return Response.json({ github: true, google: true, email: true });
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let round = 0; round < 6; round += 1) await act(async () => {});
};

it("/review asks for no queue", async () => {
  window.history.replaceState(null, "", "/review");
  const queues: string[] = [];
  act(() =>
    root.render(
      createElement(ReviewPage, {
        fetchLike: (async (input: string) => {
          queues.push(String(input));
          if (String(input) === "/api/auth/me")
            return Response.json({ user: null });
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }) as typeof fetch,
      }),
    ),
  );
  await settle();
  expect(
    container.querySelector('[data-testid="review-signed-out"]'),
  ).not.toBeNull();
  expect(queues.filter((url) => url.includes("/queue"))).toEqual([]);
  expect(requests.filter((url) => url.includes("/queue"))).toEqual([]);
});

it("My shelf asks for no Projects", async () => {
  act(() => root.render(createElement(ShelfWall)));
  await settle();
  expect(
    container.querySelector('[data-testid="shelf-signed-out"]'),
  ).not.toBeNull();
  expect(requests.filter((url) => url.startsWith("/api/projects"))).toEqual([]);
});
