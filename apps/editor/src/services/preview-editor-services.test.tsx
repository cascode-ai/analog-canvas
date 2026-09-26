import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyProject } from "@icm/model";
import { App } from "../app/App";
import { createPreviewEditorServices } from "./preview-editor-services";

afterEach(() => vi.unstubAllGlobals());
describe("desktop preview composition", () => {
  it("does not expose online actions even when legacy UI props request them", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const services = createPreviewEditorServices();
    const html = renderToStaticMarkup(
      <App
        services={services}
        project={createEmptyProject("preview", "Preview")}
        publicAgentUiEnabled
        publicSimulationUiEnabled
      />,
    );
    for (const marker of [
      'data-testid="publish-gallery-button"',
      'data-testid="examples-toggle"',
      'data-testid="open-agent"',
      'data-testid="open-analog-simulation"',
      'data-testid="file-cloud-project-list"',
    ])
      expect(html).not.toContain(marker);
    expect(html).toContain("Export Project File");
    expect(html).toContain("Desktop preview");
    expect(services.projectStore).toBeNull();
    expect(services.identity).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends prepared bytes to the private export bridge and preserves cancelled/failed results", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "saved" }))
      .mockResolvedValueOnce(Response.json({ status: "cancelled" }))
      .mockResolvedValueOnce(
        Response.json({ status: "failed", message: "disk full" }),
      );
    vi.stubGlobal("fetch", fetch);
    const delivery = createPreviewEditorServices().exportDelivery;
    const file = {
      bytes: "sample",
      mediaType: "application/json",
      suggestedName: "电路.icproj.json",
    };
    expect(await delivery.deliverFile(file)).toEqual({ status: "saved" });
    expect(fetch.mock.calls[0]![0]).toBe("/desktop/export");
    expect(await fetch.mock.calls[0]![1].body.text()).toBe("sample");
    expect(await delivery.deliverFile(file)).toEqual({ status: "cancelled" });
    await expect(delivery.deliverFile(file)).rejects.toThrow("disk full");
  });
});
