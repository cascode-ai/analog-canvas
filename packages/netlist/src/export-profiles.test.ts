import {
  CircuitProjectSchema,
  createEmptyDocument,
  createEmptyProject,
} from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import { describe, it, expect } from "vitest";
import {
  createNetlistExportProfile,
  NETLIST_DEVICE_TARGET_OPTIONS,
  NETLIST_PROFILE_LABELS,
  projectNetlistExportProfile,
  setNetlistDefaultTarget,
} from "./export-profiles.js";
import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";

function circuit() {
  const project = createEmptyProject(
    "profile-project",
    "Profile Circuit",
    "main",
  );
  const document = project.documents[0]!;
  for (const [symbolId, reference, parameters] of [
    ["nmos", "M1", { w: "2u", l: "300n", m: "2", nf: "3" }],
    ["pmos", "M2", {}],
    ["resistor", "R1", { value: "22k" }],
    ["capacitor", "C1", {}],
    ["current-source", "I1", {}],
  ] as const) {
    document.instances.push({
      id: reference,
      reference,
      symbolId,
      placement: null,
      netlist: { parameters: { ...parameters } },
    });
    for (const pinName of deviceDescriptor(symbolId)!.pinOrder)
      document.nets.push({
        id: `${reference}-${pinName}`,
        terminals: [{ instanceId: reference, pinName }],
      });
  }
  return project;
}

function exported(
  project: ReturnType<typeof circuit>,
  profile = createNetlistExportProfile("abstract"),
  format: "spice" | "spectre" = "spice",
) {
  const result = createDesignNetlistExport(project, { profile, format });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
  if (result.status !== "ready") throw new Error("export blocked");
  return result;
}

describe("netlist export presets", () => {
  it.each(["spice", "spectre"] as const)(
    "exports an authored local VDD Rail as a formal Cell Pin in %s",
    (format) => {
      const project = circuit();
      const document = project.documents[0]!;
      document.annotations.push({
        id: "rail-vdd-label",
        kind: "power-label",
        binding: {
          kind: "cell-terminal-name",
          terminalId: "rail-vdd-terminal",
        },
        netId: "M2-B",
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: "rail-vdd-claim",
        kind: "name-claim",
        netId: "M2-B",
        name: "VDD",
        scope: "local",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "rail-vdd-label" },
      });
      document.netlist!.terminals.push({
        id: "rail-vdd-terminal",
        name: "VDD",
        netId: "M2-B",
        direction: "inout",
        interfaceInstanceIds: [],
        interfaceAnnotationId: "rail-vdd-label",
      });

      const result = exported(project, undefined, format);
      expect(result.file.text).toContain(
        format === "spice" ? ".subckt dut VDD\n" : "subckt dut (VDD)\n",
      );
      expect(result.file.text).not.toContain("VSS");
      expect(result.file.text).not.toContain("global VDD");
    },
  );
  it.each([false, true])(
    "exports a local supply as a Pin only when formally declared (formal: %s)",
    (formal) => {
      const project = circuit();
      const document = project.documents[0]!;
      document.instances.push({
        id: "power",
        symbolId: "vdd-port",
        placement: null,
      });
      document.nets
        .find((net) => net.id === "M2-B")!
        .terminals.push({ instanceId: "power", pinName: "P" });
      document.connectivityEvidence.push({
        id: "power-claim",
        kind: "name-claim",
        netId: "M2-B",
        name: "VDD",
        scope: "local",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "power" },
      });
      document.netlist!.terminals.push({
        id: "signal",
        name: "SIG",
        netId: "M1-G",
        direction: "input",
        interfaceInstanceIds: [],
      });
      if (formal)
        document.netlist!.terminals.push({
          id: "supply",
          name: "VDD",
          netId: "M2-B",
          direction: "inout",
          interfaceInstanceIds: ["power"],
        });
      const result = exported(project);
      expect(result.file.text).toContain(
        formal ? ".subckt dut SIG VDD\n" : ".subckt dut SIG\n",
      );
      expect(result.file.text).not.toContain(".global");
      expect(result.file.text).not.toContain("VSS");
    },
  );
  it.each(["spice", "spectre"] as const)(
    "preserves explicit AVDD/DVDD pin order and ground 0 without adding supplies in %s",
    (format) => {
      const project = circuit();
      const document = project.documents[0]!;
      for (const [name, netId] of [
        ["SIG", "M1-G"],
        ["DVDD", "M2-B"],
        ["AVDD", "M2-S"],
      ]) {
        document.instances.push({
          id: name!,
          symbolId: "port",
          placement: null,
        });
        document.nets
          .find((net) => net.id === netId)!
          .terminals.push({ instanceId: name!, pinName: "P" });
        document.netlist!.terminals.push({
          id: `terminal-${name}`,
          name: name!,
          netId: netId!,
          direction: "inout",
          interfaceInstanceIds: [name!],
        });
      }
      document.instances.push({
        id: "GND",
        symbolId: "ground",
        placement: null,
      });
      document.nets
        .find((net) => net.id === "M1-B")!
        .terminals.push({
          instanceId: "GND",
          pinName: deviceDescriptor("ground")!.pinOrder[0]!,
        });
      document.connectivityEvidence.push({
        id: "ground-claim",
        kind: "name-claim",
        netId: "M1-B",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "power-marker", objectId: "GND" },
      });
      const before = structuredClone(project);
      const result = exported(project, undefined, format);
      expect(result.file.text).toContain(
        format === "spice"
          ? ".subckt dut SIG DVDD AVDD\n"
          : "subckt dut (SIG DVDD AVDD)\n",
      );
      expect(result.file.text).toMatch(
        format === "spice"
          ? /M1 \S+ SIG \S+ 0 NMOS/u
          : /M1 \(\S+ SIG \S+ 0\) NMOS/u,
      );
      expect(result.file.text).toMatch(
        format === "spice"
          ? /M2 \S+ \S+ AVDD DVDD PMOS/u
          : /M2 \(\S+ \S+ AVDD DVDD\) PMOS/u,
      );
      expect(result.file.text).not.toMatch(/\b(?:VDD|VSS)\b/u);
      expect(project).toEqual(before);
    },
  );
  it("offers process-specific device target choices including every default", () => {
    for (const id of [
      "abstract",
      "sky130",
      "tsmc28",
      "tsmc180",
      "custom",
    ] as const) {
      const profile = createNetlistExportProfile(id);
      expect(NETLIST_DEVICE_TARGET_OPTIONS[id].nmos).toContain(
        profile.devices.nmos.target,
      );
      expect(NETLIST_DEVICE_TARGET_OPTIONS[id].pmos).toContain(
        profile.devices.pmos.target,
      );
      expect(NETLIST_DEVICE_TARGET_OPTIONS[id].resistor).toContain(
        profile.devices.resistor.target,
      );
      expect(NETLIST_DEVICE_TARGET_OPTIONS[id].capacitor).toContain(
        profile.devices.capacitor.target,
      );
      expect(NETLIST_DEVICE_TARGET_OPTIONS[id].inductor).toContain(
        profile.devices.inductor.target,
      );
    }
    expect(NETLIST_DEVICE_TARGET_OPTIONS.sky130.nmos).toContain(
      "sky130_fd_pr__nfet_01v8_lvt",
    );
    expect(NETLIST_DEVICE_TARGET_OPTIONS.sky130.nmos).toContain(
      "sky130_fd_pr__nfet_03v3_nvt",
    );
    expect(NETLIST_DEVICE_TARGET_OPTIONS.sky130.pmos).toContain(
      "sky130_fd_pr__pfet_01v8_hvt",
    );
    expect(NETLIST_DEVICE_TARGET_OPTIONS.sky130.resistor).toContain(
      "sky130_fd_pr__res_xhigh_po",
    );
    expect(NETLIST_DEVICE_TARGET_OPTIONS.sky130.capacitor).toContain(
      "sky130_fd_pr__cap_var_lvt",
    );
    expect(NETLIST_DEVICE_TARGET_OPTIONS.sky130.inductor).toContain(
      "sky130_fd_pr__ind_05_220",
    );
    expect(NETLIST_DEVICE_TARGET_OPTIONS.tsmc28.pmos).toContain("pch_lvt_mac");
    expect(NETLIST_DEVICE_TARGET_OPTIONS.tsmc180.nmos).toEqual([
      "nch",
      "nch_mac",
    ]);
  });

  it("maps TSMC 28 ULVT wrappers, model entry, and m to multi", () => {
    const profile = createNetlistExportProfile("tsmc28");
    expect(profile.devices.nmos.target).toBe("nch_ulvt_mac");
    expect(profile.devices.pmos.target).toBe("pch_ulvt_mac");
    expect(profile.devices.nmos.parameters).toMatchObject({
      l: "30n",
      w: "1u",
      nf: "1",
      multi: "1",
    });
    expect(profile.devices.nmos.parameters).not.toHaveProperty("m");
    expect(profile.library).toEqual({
      path: "toplevel.scs",
      section: "TOP_TT",
    });
    expect(NETLIST_PROFILE_LABELS.tsmc28).toBe("TSMC 28");

    const result = exported(circuit(), profile, "spectre");

    expect(result.placeholders).toEqual([]);
    expect(result.file.text).toMatch(
      /^simulator lang=spectre\ninclude "toplevel\.scs" section=TOP_TT\n/u,
    );
    expect(result.file.text).toContain("nch_ulvt_mac l=300n multi=2 nf=3 w=2u");
    expect(result.file.text).toContain("pch_ulvt_mac l=30n multi=1 nf=1 w=1u");
    expect(result.file.text).not.toMatch(/\bm=/u);
    expect(result.file.text).toMatch(/\nR1 .* resistor r=22k\n/u);
    expect(result.file.text).toMatch(/\nC1 .* capacitor c=1p\n/u);
  });

  it("maps TSMC 180 native MOS names while retaining m", () => {
    const profile = createNetlistExportProfile("tsmc180");
    expect(profile.devices.nmos.target).toBe("nch");
    expect(profile.devices.pmos.target).toBe("pch");
    expect(profile.devices.nmos.parameters).toMatchObject({
      l: "180n",
      w: "1u",
      nf: "1",
      m: "1",
    });
    expect(profile.devices.pnp).toMatchObject({
      target: "pnp10_5_rpo",
      parameters: { m: "1" },
    });
    expect(profile.library).toEqual({
      path: "cmn018_gp2a_5v_v1d4_usage.scs",
      section: "tt_lib",
    });
    expect(NETLIST_PROFILE_LABELS.tsmc180).toBe("TSMC 180");

    const project = circuit();
    const document = project.documents[0]!;
    document.instances.push({
      id: "Q1",
      reference: "Q1",
      symbolId: "pnp",
      placement: null,
      netlist: { parameters: { m: "4" } },
    });
    for (const pinName of deviceDescriptor("pnp")!.pinOrder)
      document.nets.push({
        id: `Q1-${pinName}`,
        terminals: [{ instanceId: "Q1", pinName }],
      });
    const result = exported(project, profile, "spectre");

    expect(result.placeholders).toEqual([]);
    expect(result.file.text).toMatch(
      /^simulator lang=spectre\ninclude "cmn018_gp2a_5v_v1d4_usage\.scs" section=tt_lib\n/u,
    );
    expect(result.file.text).toContain("nch l=300n m=2 nf=3 w=2u");
    expect(result.file.text).toContain("pch l=180n m=1 nf=1 w=1u");
    expect(result.file.text).toMatch(/\nQ1 .* pnp10_5_rpo m=4\n/u);
    expect(result.file.text).not.toContain("multi=");
    expect(result.file.text).toMatch(/\nR1 .* resistor r=22k\n/u);
    expect(result.file.text).toMatch(/\nC1 .* capacitor c=1p\n/u);
  });

  it.each(["spice", "spectre"] as const)(
    "supplies abstract %s targets and defaults while retaining authored values",
    (format) => {
      const project = circuit();
      const before = structuredClone(project);
      const result = exported(project, undefined, format);
      expect(result.placeholders).toEqual([]);
      expect(result.file.text).toContain("NMOS l=300n m=2 nf=3 w=2u");
      expect(result.file.text).toContain("PMOS l=150n m=1 nf=1 w=1u");
      expect(result.file.text).toContain("22k");
      expect(result.file.text).toContain("1p");
      expect(result.file.text).toContain("100u");
      expect(result.file.text).not.toMatch(/\.model|model NMOS|sky130_fd_pr/u);
      expect(project).toEqual(before);
      expect(analyzeDesignNetlist(project).ir).toBeNull();
    },
  );

  it.each(["spice", "spectre"] as const)(
    "preserves authored module interfaces and hierarchy calls without supplies in %s",
    (format) => {
      const project = createEmptyProject("hierarchy", "Hierarchy", "top");
      const top = project.documents[0]!;
      top.netlist!.name = "top";
      const child = createEmptyDocument("child", "child");
      project.documents.push(child);
      child.instances.push({
        id: "P1",
        symbolId: "port",
        placement: null,
      });
      child.nets.push({
        id: "signal",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      });
      child.netlist!.terminals.push({
        id: "terminal-signal",
        name: "SIG",
        netId: "signal",
        direction: "inout",
        interfaceInstanceIds: ["P1"],
      });
      top.instances.push({
        id: "X1",
        symbolId: "child-symbol",
        reference: "X1",
        placement: null,
        netlist: {
          binding: { kind: "subcircuit", childDocumentId: child.id },
          parameters: {},
        },
      });
      top.nets.push({
        id: "parent-signal",
        terminals: [{ instanceId: "X1", pinName: "SIG" }],
      });
      expect(CircuitProjectSchema.safeParse(project).success).toBe(true);
      const before = structuredClone(project);

      const strict = analyzeDesignNetlist(project, { format }).ir!;
      expect(strict.cells.find((cell) => cell.id === child.id)?.ports).toEqual([
        expect.objectContaining({ name: "SIG" }),
      ]);
      const result = exported(
        project,
        createNetlistExportProfile("abstract"),
        format,
      );

      if (format === "spice") {
        expect(result.file.text).toContain(".subckt child SIG\n");
        expect(result.file.text).toMatch(/X1 net\d+ child/u);
        expect(result.file.text).toContain(".subckt top\n");
      } else {
        expect(result.file.text).toContain("subckt child (SIG)");
        expect(result.file.text).toMatch(/X1 \(net\d+\) child/u);
        expect(result.file.text).toContain("subckt top");
      }
      expect(project).toEqual(before);
    },
  );

  it("maps SKY130 MOS pin order and metre geometry, retaining ideal passive values by default", () => {
    const project = circuit();
    const before = structuredClone(project);
    const profile = createNetlistExportProfile("sky130");
    const projected = projectNetlistExportProfile(project, profile);
    const mapped = analyzeDesignNetlist(projected.project).ir!;
    const native = analyzeDesignNetlist(
      projectNetlistExportProfile(
        project,
        createNetlistExportProfile("abstract"),
      ).project,
    ).ir!;
    for (const instance of native.cells[0]!.instances) {
      expect(
        mapped.cells[0]!.instances.find((i) => i.id === instance.id)?.nodes,
      ).toEqual(instance.nodes);
    }
    const result = exported(project, profile);
    expect(result.file.text).toMatch(/^\n\.lib "sky130.lib.spice" tt\n/u);
    expect(result.file.text).not.toMatch(/^(?:\*|\/\/)/mu);
    expect(result.file.text).toMatch(
      /XM1 .* sky130_fd_pr__nfet_01v8 l=0.3 w=2 nf=3 m=2/u,
    );
    expect(result.file.text).toMatch(
      /XM2 .* sky130_fd_pr__pfet_01v8 l=0.15 w=1 nf=1 m=1/u,
    );
    expect(result.file.text).toMatch(/\nR1 .* 22k\n/u);
    expect(result.file.text).toMatch(/\nC1 .* 1p\n/u);
    expect(project).toEqual(before);
    const scs = exported(project, profile, "spectre");
    expect(scs.file.extension).toBe(".scs");
    expect(scs.file.text).toMatch(
      /^simulator lang=spectre\ninclude "sky130\.lib\.spice" section=tt\n/u,
    );
    expect(scs.file.text).not.toContain("simulator lang=spice");
    expect(scs.file.text).toContain("subckt dut\n");
    expect(scs.file.text).toMatch(
      /XM1 \([^\n]+\) sky130_fd_pr__nfet_01v8 l=0.3 w=2 nf=3 m=2/u,
    );
    expect(scs.file.text).not.toContain(".subckt");
    expect(scs.file.text).not.toContain(".global");
  });

  it.each(["abstract", "sky130"] as const)(
    "does not invent a missing MOS Bulk or supply with the %s preset",
    (profileId) => {
      for (const instanceId of ["M1", "M2"]) {
        const project = circuit();
        const document = project.documents[0]!;
        for (const net of document.nets)
          net.terminals = net.terminals.filter(
            (terminal) =>
              terminal.instanceId !== instanceId || terminal.pinName !== "B",
          );
        const before = structuredClone(project);
        const profile = createNetlistExportProfile(profileId);
        const projected = projectNetlistExportProfile(project, profile);
        expect(projected.project.documents[0]!.nets).toEqual(document.nets);
        expect(projected.project.documents[0]!.connectivityEvidence).toEqual(
          document.connectivityEvidence,
        );
        const result = createDesignNetlistExport(project, { profile });
        expect(result.status).toBe("blocked");
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "MISSING_PIN_NET",
            objectIds: [instanceId],
          }),
        );
        expect(project).toEqual(before);
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "preserves explicit global VDD and actual PMOS Bulk in %s",
    (format) => {
      const project = circuit();
      const document = project.documents[0]!;
      document.instances.push({
        id: "VDD1",
        symbolId: "vdd-port",
        placement: null,
      });
      document.nets
        .find((net) => net.id === "M2-B")!
        .terminals.push({
          instanceId: "VDD1",
          pinName: "P",
        });
      document.connectivityEvidence.push({
        id: "vdd-claim",
        kind: "name-claim",
        netId: "M2-B",
        name: "VDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VDD1" },
      });
      const before = structuredClone(project);
      const profile = createNetlistExportProfile("abstract");
      const projected = projectNetlistExportProfile(project, profile);
      expect(projected.project.documents[0]!.connectivityEvidence).toEqual(
        document.connectivityEvidence,
      );
      const result = exported(project, profile, format);
      expect(result.file.text).toContain(
        format === "spice" ? ".global VDD" : "global VDD",
      );
      expect(result.file.text).toContain(
        format === "spice" ? ".subckt dut\n" : "subckt dut\n",
      );
      expect(result.file.text).not.toContain("VSS");
      expect(project).toEqual(before);

      // The marker the author placed is the body default. A PMOS whose B
      // nobody wired follows the one VDD marker in the Cell, with no per-Cell
      // setting to configure — which is what makes a pasted copy, an imported
      // drawing, and a drawing made before the policy existed all behave the
      // same.
      document.nets.find((net) => net.id === "M2-B")!.terminals = [
        { instanceId: "VDD1", pinName: "P" },
      ];
      const defaulted = createDesignNetlistExport(project, { profile, format });
      expect(defaulted.status).toBe("ready");
      if (defaulted.status === "ready") {
        // Drain, gate, source, then the fourth node the policy supplied.
        expect(defaulted.file.text).toMatch(
          format === "spice"
            ? /M2 \S+ \S+ \S+ VDD PMOS/u
            : /M2 \(\S+ \S+ \S+ VDD\) PMOS/u,
        );
      }

      // Two supplies is a question, not a vote. With AVDD beside VDD the
      // policy stays silent and the omitted Bulk is blocking again, exactly
      // as it was before any marker was placed.
      document.instances.push({
        id: "VDD2",
        symbolId: "vdd-port",
        placement: null,
      });
      document.nets.push({
        id: "avdd",
        terminals: [{ instanceId: "VDD2", pinName: "P" }],
      });
      document.connectivityEvidence.push({
        id: "avdd-claim",
        kind: "name-claim",
        netId: "avdd",
        name: "AVDD",
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: "VDD2" },
      });
      const ambiguous = createDesignNetlistExport(project, { profile, format });
      expect(ambiguous.status).toBe("blocked");
      expect(
        ambiguous.diagnostics.some(
          (item) =>
            item.code === "MISSING_PIN_NET" && item.message.includes("M2.B"),
        ),
      ).toBe(true);
    },
  );

  it("keeps an explicit PMOS Bulk NoConnect instead of applying the preset default", () => {
    const project = circuit();
    const document = project.documents[0]!;
    for (const net of document.nets)
      net.terminals = net.terminals.filter(
        (terminal) => terminal.instanceId !== "M2" || terminal.pinName !== "B",
      );
    document.noConnects.push({
      id: "M2-B-open",
      endpoint: { kind: "terminal", instanceId: "M2", pinName: "B" },
    });

    const result = exported(project);
    expect(result.file.text).toMatch(/\nM2 \S+ \S+ \S+ NC0001 PMOS/u);
    expect(
      result.diagnostics.some(
        (item) => item.code === "EXPORT_SUBSTRATE_DEFAULT",
      ),
    ).toBe(false);
  });

  it("does not guess a missing Bulk for an imported PMOS", () => {
    const project = circuit();
    const document = project.documents[0]!;
    for (const net of document.nets)
      net.terminals = net.terminals.filter(
        (terminal) => terminal.instanceId !== "M2" || terminal.pinName !== "B",
      );
    document.instances.find(
      (instance) => instance.id === "M2",
    )!.importProvenance = {
      kind: "model",
      sourceMasterName: "PMOS",
      sourceTarget: "PMOS",
    };

    const result = createDesignNetlistExport(project, {
      profile: createNetlistExportProfile("abstract"),
    });
    expect(result.status).toBe("blocked");
    expect(
      result.diagnostics.filter((item) => item.code === "MISSING_PIN_NET"),
    ).toHaveLength(1);
  });

  it("supports explicit physical R/C geometry and a default substrate without converting ideal values", () => {
    const project = circuit();
    const before = structuredClone(project);
    let profile = setNetlistDefaultTarget(
      createNetlistExportProfile("sky130"),
      "resistor",
      "sky130_fd_pr__res_high_po",
    );
    profile = setNetlistDefaultTarget(
      profile,
      "capacitor",
      "sky130_fd_pr__cap_mim_m3_1",
    );
    const result = exported(project, profile);
    expect(result.file.text).toMatch(
      /XR1 \S+ \S+ 0 sky130_fd_pr__res_high_po w=1 l=5.5 mult=1/u,
    );
    expect(result.file.text).toMatch(
      /XC1 \S+ \S+ sky130_fd_pr__cap_mim_m3_1 w=5 l=5 mf=1/u,
    );
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("ideal value 22k is not converted"),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.message.includes("uses substrate 0")),
    ).toBe(true);
    expect(project).toEqual(before);
    profile.devices.resistor.substrate = "nonexistent";
    expect(createDesignNetlistExport(project, { profile }).status).toBe(
      "blocked",
    );
    profile.devices.resistor.substrate = "0";
    profile.devices.resistor.parameters.w = "";
    expect(createDesignNetlistExport(project, { profile }).status).toBe(
      "blocked",
    );
  });

  it("maps a two-pin inductor to the reviewed SKY130 CT/substrate interface", () => {
    const project = circuit();
    const document = project.documents[0]!;
    document.instances.push({
      id: "L1",
      reference: "L1",
      symbolId: "inductor",
      placement: null,
      netlist: { parameters: { value: "4n" } },
    });
    for (const pinName of deviceDescriptor("inductor")!.pinOrder)
      document.nets.push({
        id: `L1-${pinName}`,
        terminals: [{ instanceId: "L1", pinName }],
      });
    const profile = setNetlistDefaultTarget(
      createNetlistExportProfile("sky130"),
      "inductor",
      "sky130_fd_pr__ind_05_220",
    );

    const result = exported(project, profile);

    expect(result.file.text).toMatch(
      /XL1 \S+ \S+ net\d+ 0 sky130_fd_pr__ind_05_220/u,
    );
    expect(result.file.text).not.toContain("4n");
    expect(
      result.diagnostics.some(
        (item) => item.code === "EXPORT_FLOATING_TERMINAL_DEFAULT",
      ),
    ).toBe(true);
  });

  it("uses editable custom defaults only for absent values and targets", () => {
    const project = circuit();
    project.documents[0]!.instances[0]!.netlist!.binding = {
      kind: "model",
      deviceClass: "mos",
      name: "MY_AUTHORED_N",
    };
    const profile = createNetlistExportProfile("custom");
    profile.devices.nmos.target = "FALLBACK_N";
    profile.devices.pmos.target = "CUSTOM_P";
    profile.devices.nmos.parameters.w = "9u";
    profile.devices.capacitor.parameters.value = "7p";
    profile.library = { path: "models/my-pdk.lib", section: "fast" };
    const result = exported(project, profile);
    expect(result.file.text).toContain("MY_AUTHORED_N l=300n m=2 nf=3 w=2u");
    expect(result.file.text).toContain("CUSTOM_P");
    expect(result.file.text).toMatch(/\nC1 .* 7p\n/u);
    expect(result.file.text).toContain('.lib "models/my-pdk.lib" fast');
    expect(exported(project, profile, "spectre").file.text).toMatch(
      /^simulator lang=spectre\ninclude "models\/my-pdk.lib" section=fast\n/u,
    );
    expect(result.file.text).not.toContain("FALLBACK_N");
    expect(result.file.text).not.toContain("w=9u");
  });

  it("can abstract existing reviewed PDK devices without changing the source", () => {
    const original = projectNetlistExportProfile(
      circuit(),
      createNetlistExportProfile("sky130"),
    ).project;
    const before = structuredClone(original);
    const result = exported(
      original,
      createNetlistExportProfile("abstract"),
      "spectre",
    );
    expect(result.file.text).toContain("simulator lang=spectre");
    expect(result.file.text).toContain("NMOS l=300n m=2 nf=3 w=2u");
    expect(result.file.text).not.toContain("sky130_fd_pr");
    expect(original).toEqual(before);
  });

  it("does not hide connectivity errors, target-class conflicts, or invalid preferences", () => {
    const project = circuit();
    project.documents[0]!.nets.shift();
    expect(
      createDesignNetlistExport(project, {
        profile: createNetlistExportProfile("abstract"),
      }).status,
    ).toBe("blocked");
    const profile = createNetlistExportProfile("sky130");
    profile.devices.nmos.target = "sky130_fd_pr__pfet_01v8";
    expect(createDesignNetlistExport(circuit(), { profile }).status).toBe(
      "blocked",
    );
    profile.devices.nmos.target = "bad target";
    expect(createDesignNetlistExport(circuit(), { profile }).status).toBe(
      "blocked",
    );
    profile.devices.nmos.target = "sky130_fd_pr__nfet_01v8";
    profile.library.path = 'evil"\n.end';
    expect(createDesignNetlistExport(circuit(), { profile }).status).toBe(
      "blocked",
    );
  });
  it("keeps authored transient and AC source bias semantics", () => {
    const project = circuit();
    const source = project.documents[0]!.instances.find((i) => i.id === "I1")!;
    for (const parameters of [
      {
        waveform: "pulse",
        val0: "0",
        val1: "1m",
        delay: "0",
        rise: "1n",
        fall: "1n",
        width: "1u",
        period: "2u",
      },
      { acmag: "1" },
    ]) {
      source.netlist!.parameters = parameters as Record<string, string>;
      const projected = projectNetlistExportProfile(
        project,
        createNetlistExportProfile("abstract"),
      );
      expect(
        projected.project.documents[0]!.instances.find((i) => i.id === "I1")!
          .netlist!.parameters,
      ).toEqual(parameters);
    }
  });

  it("leaves unreachable documents alone and rejects reference and interface collisions", () => {
    const project = circuit();
    const unreachable = structuredClone(project.documents[0]!);
    unreachable.id = "unreachable";
    unreachable.instances[0]!.reference = "invalid-reference";
    project.documents.push(unreachable);
    exported(project);
    expect(
      projectNetlistExportProfile(project, createNetlistExportProfile("sky130"))
        .project.documents[1],
    ).toEqual(unreachable);
    project.documents[0]!.instances[1]!.reference = "XM1";
    expect(
      createDesignNetlistExport(project, {
        profile: createNetlistExportProfile("sky130"),
      }).status,
    ).toBe("blocked");
    const conflict = circuit();
    conflict.externalSubcircuitDefinitions.push({
      id: "conflict",
      name: "sky130_fd_pr__nfet_01v8",
      interfaceStatus: "declared",
      terminals: [],
      formalParameters: [],
    });
    expect(
      createDesignNetlistExport(conflict, {
        profile: createNetlistExportProfile("sky130"),
      }).status,
    ).toBe("blocked");
  });
  it("retains authored SKY130 device variants and physical passives when using SKY130 defaults", () => {
    let profile = createNetlistExportProfile("sky130");
    profile.devices.nmos.target = "sky130_fd_pr__nfet_01v8_lvt";
    profile = setNetlistDefaultTarget(
      profile,
      "capacitor",
      "sky130_fd_pr__cap_mim_m3_1",
    );
    const authored = projectNetlistExportProfile(circuit(), profile).project;
    const result = exported(authored, createNetlistExportProfile("sky130"));
    expect(result.file.text).toContain("sky130_fd_pr__nfet_01v8_lvt");
    expect(result.file.text).toContain("sky130_fd_pr__cap_mim_m3_1");
    expect(result.file.text).not.toMatch(/\nC1 /u);
  });
});
