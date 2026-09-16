import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import fixture from "../../../netlists/ngspice-ota-qualification/source.icproj.json";
import { ngspiceSignals } from "./simulation-ngspice-signal-names.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { ngspiceAcquisitionEdit } from "./simulation-ngspice-save-edit.js";

it("retains real OTA Canvas voltage mapping on the ngspice path", () => {
  const project = parseProject(JSON.stringify(fixture));
  const folder = project.simulationFolders[0]!;
  expect(compileNgspiceSourceSimulation(project, folder).ok).toBe(true);
  const signals = ngspiceSignals(project, folder.input);
  expect(Object.keys(signals).length).toBeGreaterThan(0);
  for (const [vector, signal] of Object.entries(signals)) {
    expect(vector).toMatch(/^v\(.+\)$/);
    expect(signal.targets.length).toBeGreaterThan(0);
    for (const target of signal.targets)
      expect(project.documents.some((d) => d.id === target.documentId)).toBe(
        true,
      );
  }
});

it("inserts ngspice acquisitions without native control syntax and without duplicating saves", () => {
  const a = ngspiceAcquisitionEdit(
    "Title\n.control\nop\n.endc\n.end\n",
    0,
    ["v(out)"],
    true,
  );
  expect(a.text).toContain(".control\nsave v(out)\nop");
  const b = ngspiceAcquisitionEdit(
    a.text,
    a.text.indexOf("save") + 5,
    ["v(out)"],
    true,
  );
  expect(b.text).toBe(a.text);
});
