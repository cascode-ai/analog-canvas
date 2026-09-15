import { expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { nativeAuthoringHelp } from "@icm/netlist";
import { SimulationService } from "./service.js";
import { SimulationFiles } from "./files.js";
import { SimulationReplySchema } from "./contract.js";

it("exposes the GUI catalogue without contacting the executor or changing authored state, and recovers a missing helper", async () => {
  const capabilities = vi.fn(() => {
    throw Error("offline");
  });
  const execute = vi.fn(() => {
    throw Error("must not run");
  });
  const cancel = vi.fn(async () => {});
  const project = createEmptyProject("p", "Help", "main");
  const before = structuredClone(project);
  const files = new SimulationFiles();
  const service = new SimulationService(
    files,
    { capabilities, execute, cancel },
    () => project,
  );
  const reply = await service.handle(
    { operation: "authoring-help", name: "embed" },
    "help",
  );
  expect(SimulationReplySchema.parse(reply)).toEqual({
    ok: true,
    helpers: nativeAuthoringHelp({ name: "embed" }),
  });
  expect(
    await service.handle(
      { operation: "authoring-help", name: "unknown" },
      "bad",
    ),
  ).toMatchObject({
    ok: false,
    error: { code: "SIMULATION_HELPER_NOT_FOUND", recovery: "fix-input" },
  });
  const next = await service.handle({ operation: "authoring-help" }, "again");
  expect(next).toEqual({ ok: true, helpers: nativeAuthoringHelp() });
  expect(
    await service.handle(
      { operation: "authoring-help", context: "invalid" },
      "invalid",
    ),
  ).toMatchObject({ ok: false, error: { code: "SIMULATION_REQUEST_INVALID" } });
  expect(capabilities).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(project).toEqual(before);
  expect(await files.handle({ action: "list" })).toEqual({
    ok: true,
    workspaces: [],
  });
});
