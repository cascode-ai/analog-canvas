import { describe, expect, it } from "vitest";
import { AgentSimulationResourceRequestSchema } from "@icm/agent-adapter";
import { liveAgentEditor } from "./live-agent-editor.test-support";

describe("live editor capability announcement", () => {
  it("announces model source and artwork structure edits from the canonical contract", async () => {
    const editor = liveAgentEditor();
    const connected = await editor.client.connect("session-1.code");
    expect(connected.capabilities.editKinds).toEqual(
      expect.arrayContaining([
        "apply_model_source",
        "save_model_source_draft",
        "capture_component_definition",
      ]),
    );
  });
  it("announces every canonical simulation operation without an executor probe", async () => {
    const editor = liveAgentEditor({
      simulationService: async () => {
        throw new Error("capability announcement must not query executor");
      },
    });
    await editor.client.connect("session-1.code");
    const { capabilities } = await editor.client.capabilities();
    expect(capabilities.resources?.simulation?.operations).toEqual(
      AgentSimulationResourceRequestSchema.options.map(
        (schema) => schema.shape.operation.value,
      ),
    );
    expect(capabilities.resources?.simulation?.operations).toEqual(
      expect.arrayContaining([
        "run",
        "authoring-help",
        "catalog",
        "history",
        "history-usage",
        "history-delete",
      ]),
    );
  });

  it("omits simulation operations when this editor host does not enable simulation", async () => {
    const editor = liveAgentEditor();
    await editor.client.connect("session-1.code");
    expect(
      (await editor.client.capabilities()).capabilities.resources?.simulation,
    ).toBeUndefined();
  });
});
