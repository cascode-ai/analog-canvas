import { createEmptyProject } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";
import { describe, it, expect } from "vitest";
import {
  createNetlistExportProfile,
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
      /^simulator lang=spice\n\.lib "sky130\.lib\.spice" tt\nsimulator lang=spectre\n/u,
    );
    expect(scs.file.text).toContain("global 0 VDD");
    expect(scs.file.text).toContain("subckt Main\n");
    expect(scs.file.text).toMatch(
      /XM1 \([^\n]+\) sky130_fd_pr__nfet_01v8 l=0.3 w=2 nf=3 m=2/u,
    );
    expect(scs.file.text).not.toContain(".subckt");
    expect(scs.file.text).not.toContain(".global");
  });

  it.each(["spice", "spectre"] as const)(
    "keeps SKY130 export available when MOS bulk is omitted in %s",
    (format) => {
      const project = circuit();
      const document = project.documents[0]!;
      for (const instanceId of ["M1", "M2"])
        for (const net of document.nets)
          net.terminals = net.terminals.filter(
            (terminal) =>
              terminal.instanceId !== instanceId || terminal.pinName !== "B",
          );
      const profile = createNetlistExportProfile("sky130");

      expect(profile.devices.nmos.substrate).toBe("0");
      expect(profile.devices.pmos.substrate).toBe("VDD");
      const result = exported(project, profile, format);
      if (format === "spice") {
        expect(result.file.text).toMatch(
          /XM1 \S+ \S+ \S+ 0 sky130_fd_pr__nfet_01v8/u,
        );
        expect(result.file.text).toMatch(
          /XM2 \S+ \S+ \S+ VDD sky130_fd_pr__pfet_01v8/u,
        );
        expect(result.file.text).toContain(".global 0 VDD");
      } else {
        expect(result.file.text).toMatch(
          /XM1 \(\S+ \S+ \S+ 0\) sky130_fd_pr__nfet_01v8/u,
        );
        expect(result.file.text).toMatch(
          /XM2 \(\S+ \S+ \S+ VDD\) sky130_fd_pr__pfet_01v8/u,
        );
        expect(result.file.text).toContain("global 0 VDD");
        expect(result.file.text).not.toContain(".global VDD");
      }
    },
  );

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
