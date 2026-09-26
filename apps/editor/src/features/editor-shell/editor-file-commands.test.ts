import { createEmptyProject } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hierarchyParameterFixture } from "../../../../../netlists/hierarchy-parameters/fixture";
import { ChunkLoadError } from "../../components/chunk-import";
import type { EditorExportDelivery } from "../../hosts/export-delivery";
import {
  createEditorFileCommands,
  type EditorFileCommandDependencies,
} from "./editor-file-commands";
import {
  createSvgExportArtifact,
  createVisualExportArtifact,
  planDesignNetlistExport,
  type EditorExportArtifact,
} from "./editor-export-commands";

vi.mock("./editor-export-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./editor-export-commands")>()),
  createSvgExportArtifact: vi.fn(),
  createVisualExportArtifact: vi.fn(),
}));

function commands(overrides: Partial<EditorFileCommandDependencies> = {}) {
  const project =
    overrides.project ?? createEmptyProject("project", "My Circuit / 1");
  const deliverFile = vi
    .fn<EditorExportDelivery["deliverFile"]>()
    .mockResolvedValue({ status: "saved" });
  const copyText = vi
    .fn<EditorExportDelivery["copyText"]>()
    .mockResolvedValue();
  const dependencies = {
    project,
    document: project.documents[0]!,
    resolver: new InMemorySymbolResolver([]),
    defaultViewBox: { x: 0, y: 0, width: 960, height: 640 },
    exportDelivery: { deliverFile, copyText },
    electricalWarningsPresent: () => false,
    guardDirtyReplacement: vi.fn(),
    replaceActiveProject: vi.fn(),
    showNetlist: vi.fn(),
    setImportReport: vi.fn(),
    setImportReviewOpen: vi.fn(),
    setSelectionOpen: vi.fn(),
    setStatus: vi.fn(),
    onChunkLoadFailure: vi.fn(),
    ...overrides,
  } satisfies EditorFileCommandDependencies;
  return {
    ...createEditorFileCommands(dependencies),
    dependencies,
    deliverFile,
    copyText,
  };
}

function prepareVisual(format: "svg" | "png" | "pdf") {
  const artifact: EditorExportArtifact = {
    bytes: format === "svg" ? "<svg/>" : new Uint8Array([1, 2, 3]),
    mediaType:
      format === "svg"
        ? "image/svg+xml"
        : format === "png"
          ? "image/png"
          : "application/pdf",
    extension: format,
    report: "Exported revision 7; preserve the fidelity warning",
  };
  vi.mocked(createSvgExportArtifact).mockResolvedValue(artifact);
  vi.mocked(createVisualExportArtifact).mockResolvedValue(artifact);
  return artifact;
}

beforeEach(() => {
  vi.resetAllMocks();
  // Commands must be usable through an injected host without browser I/O.
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("navigator", undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(["svg", "png", "pdf"] as const)("%s file delivery", (format) => {
  const run = (target: ReturnType<typeof commands>) =>
    format === "svg" ? target.exportSvg() : target.exportRaster(format);

  it("waits for the host, preserving bytes, filename and fidelity report without changing the Project", async () => {
    const artifact = prepareVisual(format);
    const target = commands();
    const before = structuredClone(target.dependencies.project);
    const pending = Promise.withResolvers<{ status: "saved" }>();
    target.deliverFile.mockReturnValue(pending.promise);
    const completed = run(target);
    await vi.waitFor(() => expect(target.deliverFile).toHaveBeenCalledOnce());
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      `Preparing ${format.toUpperCase()} export`,
    );
    expect(target.deliverFile).toHaveBeenCalledWith({
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
      suggestedName: `my-circuit-1.${format}`,
    });
    pending.resolve({ status: "saved" });
    await completed;
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      artifact.report,
    );
    expect(target.dependencies.project).toEqual(before);
    expect(target.dependencies.replaceActiveProject).not.toHaveBeenCalled();
  });

  it("does not report success after a cancelled save dialog", async () => {
    const artifact = prepareVisual(format);
    const target = commands();
    target.deliverFile.mockResolvedValue({ status: "cancelled" });
    await run(target);
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Export cancelled",
    );
    expect(target.dependencies.setStatus).not.toHaveBeenCalledWith(
      artifact.report,
    );
  });

  it("reports a failed delivery instead of claiming success", async () => {
    const artifact = prepareVisual(format);
    const target = commands();
    target.deliverFile.mockRejectedValue(new Error("Disk is full"));
    await run(target);
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Disk is full",
    );
    expect(target.dependencies.setStatus).not.toHaveBeenCalledWith(
      artifact.report,
    );
  });
});

it("keeps the existing Web report after requesting a download", async () => {
  const artifact = prepareVisual("svg");
  const target = commands();
  target.deliverFile.mockResolvedValue({ status: "download-requested" });
  await target.exportSvg();
  expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
    artifact.report,
  );
});

it("does not deliver a failed visual build and keeps the chunk refresh remedy", async () => {
  const target = commands();
  vi.mocked(createVisualExportArtifact).mockRejectedValue(
    new ChunkLoadError("PDF export", new Error("missing chunk")),
  );
  await target.exportRaster("pdf");
  expect(target.deliverFile).not.toHaveBeenCalled();
  expect(target.dependencies.onChunkLoadFailure).toHaveBeenCalledWith(
    "PDF export",
  );
  expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
    expect.stringContaining("Refresh"),
  );
});

describe("netlist delivery", () => {
  it.each(["spice", "spectre"] as const)(
    "copies the current %s plan with the chosen root and warnings through the host",
    async (format) => {
      const project = hierarchyParameterFixture();
      project.documents[0]!.netlist = undefined;
      const before = structuredClone(project);
      const target = commands({
        project,
        netlistRootDocumentId: "resistors",
        electricalWarningsPresent: () => true,
      });
      const pending = Promise.withResolvers<void>();
      target.copyText.mockReturnValue(pending.promise);
      const completed = target.exportDesignNetlist(format, "cadence-bang");
      const plan = planDesignNetlistExport({
        project,
        format,
        namingProfile: "cadence-bang",
        rootDocumentId: "resistors",
        electricalWarningsPresent: true,
      });
      expect(plan.status).toBe("ready");
      if (plan.status !== "ready") throw new Error("Expected a ready fixture");
      expect(target.copyText).toHaveBeenCalledWith(plan.artifact.bytes);
      expect(target.dependencies.showNetlist).toHaveBeenCalledWith(
        format,
        "cadence-bang",
      );
      expect(target.dependencies.setStatus).not.toHaveBeenCalledWith(
        plan.artifact.report,
      );
      pending.resolve();
      await completed;
      expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
        plan.artifact.report,
      );
      expect(target.deliverFile).not.toHaveBeenCalled();
      expect(project).toEqual(before);
    },
  );

  it("refuses invalid configuration before calling either delivery", async () => {
    const target = commands({
      netlistConfigurationError: "Choose a root Cell",
    });
    await target.exportDesignNetlist("spice");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Fix Netlist configuration: Choose a root Cell",
    );
    expect(target.copyText).not.toHaveBeenCalled();
    expect(target.deliverFile).not.toHaveBeenCalled();
  });

  it("does not deliver a structurally blocked netlist", async () => {
    const project = createEmptyProject("project", "Circuit");
    project.documents[0]!.netlist = undefined;
    const target = commands({ project });
    await target.exportDesignNetlist("spice");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Resolve the Check Report findings before export",
    );
    expect(target.copyText).not.toHaveBeenCalled();
    expect(target.deliverFile).not.toHaveBeenCalled();
  });

  it("preserves the sidebar-copy fallback without silently downloading on clipboard failure", async () => {
    const target = commands();
    target.copyText.mockRejectedValue(new Error("Clipboard unavailable"));
    await target.exportDesignNetlist("spice");
    expect(target.dependencies.setStatus).toHaveBeenLastCalledWith(
      "Clipboard unavailable; select the netlist in the sidebar and copy it",
    );
    expect(target.deliverFile).not.toHaveBeenCalled();
  });
});
