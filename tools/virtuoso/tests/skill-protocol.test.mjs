import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.mjs";
import {
  skillString,
  protocolEvent,
  renderExportComplete,
} from "../dist/cli/skill-protocol.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = path.join(root, "dist/cli/skill-ui.js");

test("SKILL string literal contains no raw control characters or executable quote", () => {
  assert.equal(
    skillString('a" ) load("/tmp/x")\n\\tail'),
    '"a\\" ) load(\\"/tmp/x\\") \\\\tail"',
  );
  assert.equal(
    protocolEvent("ERROR", "scan", "bad|code\n"),
    "VCUI|1|ERROR|scan|BAD_CODE_\n",
  );
  assert.match(
    renderExportComplete(
      "success_with_warnings",
      "/tmp/out",
      "design.icproj.json",
      [{ severity: "warning", message: 'bad " ) load("/tmp/x")' }],
    ),
    /bad \\" \) load\(\\"\/tmp\/x\\"\)/,
  );
});

test("scan adapter emits fixed line protocol and writes loadable SKILL data", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-test-"));
  try {
    const source = path.join(dir, "source.json");
    const out = path.join(dir, "scan.il");
    const data = fixture();
    data.instances[0].library = 'evil" ) load("pwn")';
    await fs.writeFile(source, JSON.stringify(data));
    const run = spawnSync(
      process.execPath,
      [command, "scan", source, "--out", out],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "VCUI|1|PROGRESS|scan\nVCUI|1|DONE|scan\n");
    const result = await fs.readFile(out, "utf8");
    assert.match(result, /^VCUIAcceptCatalog\(1 list\(/);
    assert.match(result, /VCUIAcceptRules\(1 list\(/);
    assert.match(result, /VCUIAcceptScan\(1 2 2 list\(/);
    assert.match(
      result,
      /list\("nmos" list\("D" "G" "S" "B"\) list\("w" "l" "m" "nf"\)\)/,
    );
    assert.match(result, /evil\\" \) load\(\\"pwn\\"\)/);
    assert.equal(result.split("\n").length, 4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("mapping apply validates session edits without writing personal rules", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-apply-"));
  try {
    const source = path.join(dir, "source.json"),
      edit = path.join(dir, "edit.json");
    const out = path.join(dir, "result.il"),
      personal = path.join(dir, "mappings.json");
    const rule = {
      symbol: "resistor",
      pins: { PLUS: "1", MINUS: "2" },
      parameters: { r: "r" },
      omitPins: [],
    };
    await fs.writeFile(source, JSON.stringify(fixture()));
    await fs.writeFile(
      edit,
      JSON.stringify({ version: 1, device: "analogLib/res", rule }),
    );
    const run = spawnSync(
      process.execPath,
      [
        command,
        "apply",
        source,
        "--edit",
        edit,
        "--out",
        out,
        "--mode",
        "session",
        "--mappings",
        personal,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "VCUI|1|PROGRESS|apply\nVCUI|1|DONE|apply\n");
    assert.equal(
      await fs.readFile(out, "utf8"),
      'VCUIAcceptMapping(1 "analogLib/res" "session" "")\n',
    );
    await assert.rejects(fs.stat(personal), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("network settings load, save and reload without losing other personal options", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-config-"));
  try {
    const config = path.join(dir, "config.json");
    const initial = {
      version: 1,
      conversion: { scale: 175 },
      presentation: {
        plainLabels: true,
        powerNets: ["VDD"],
        groundNets: ["GND"],
      },
    };
    await fs.writeFile(config, JSON.stringify(initial));
    const load = spawnSync(
      process.execPath,
      [
        command,
        "config",
        "load",
        "--out",
        path.join(dir, "loaded.il"),
        "--config",
        config,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(load.status, 0, load.stderr);
    assert.match(
      await fs.readFile(path.join(dir, "loaded.il"), "utf8"),
      /^VCUIAcceptConfig\(1 "load" list\("VDD"\) list\("GND"\)/,
    );
    const saved = spawnSync(
      process.execPath,
      [
        command,
        "config",
        "save",
        "--out",
        path.join(dir, "saved.il"),
        "--config",
        config,
        "--power-nets",
        "VDD  AVDD\tDVDD",
        "--ground-nets",
        "GND VSS",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(saved.status, 0, saved.stderr);
    const content = JSON.parse(await fs.readFile(config, "utf8"));
    assert.deepEqual(content.presentation.powerNets, ["VDD", "AVDD", "DVDD"]);
    assert.deepEqual(content.presentation.groundNets, ["GND", "VSS"]);
    assert.equal(content.presentation.plainLabels, true);
    assert.equal(content.conversion.scale, 175);
    const reloaded = spawnSync(
      process.execPath,
      [
        command,
        "config",
        "load",
        "--out",
        path.join(dir, "reloaded.il"),
        "--config",
        config,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(reloaded.status, 0, reloaded.stderr);
    assert.match(
      await fs.readFile(path.join(dir, "reloaded.il"), "utf8"),
      /list\("VDD" "AVDD" "DVDD"\) list\("GND" "VSS"\)/,
    );
    const invalid = spawnSync(
      process.execPath,
      [
        command,
        "config",
        "save",
        "--out",
        path.join(dir, "invalid.il"),
        "--config",
        config,
        "--power-nets",
        "VDD GND",
        "--ground-nets",
        "GND",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /VCUI\|1\|ERROR\|config\|INVALID_CONFIG/);
    assert.deepEqual(JSON.parse(await fs.readFile(config, "utf8")), content);
    await assert.rejects(fs.stat(path.join(dir, "invalid.il")), {
      code: "ENOENT",
    });
    const comma = spawnSync(
      process.execPath,
      [
        command,
        "config",
        "save",
        "--out",
        path.join(dir, "comma.il"),
        "--config",
        config,
        "--power-nets",
        "VDD, AVDD",
        "--ground-nets",
        "GND",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(comma.status, 1);
    assert.match(
      comma.stderr,
      /Separate network names with spaces, not commas/,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(config, "utf8")), content);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("personal apply merges atomically; rejected edits leave the table untouched", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-apply-"));
  try {
    const source = path.join(dir, "source.json"),
      edit = path.join(dir, "edit.json");
    const out = path.join(dir, "result.il"),
      personal = path.join(dir, "mappings.json");
    const rule = {
      symbol: "resistor",
      pins: { PLUS: "1", MINUS: "2" },
      parameters: { r: "r" },
      omitPins: [],
    };
    await fs.writeFile(source, JSON.stringify(fixture()));
    await fs.writeFile(
      personal,
      JSON.stringify({ version: 1, devices: { "other/device": null } }),
    );
    await fs.writeFile(
      edit,
      JSON.stringify({ version: 1, device: "analogLib/res", rule }),
    );
    const args = [
      command,
      "apply",
      source,
      "--edit",
      edit,
      "--out",
      out,
      "--mode",
      "personal",
      "--mappings",
      personal,
    ];
    const run = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const saved = JSON.parse(await fs.readFile(personal, "utf8"));
    assert.deepEqual(saved.devices["analogLib/res"], rule);
    assert.equal(saved.devices["other/device"], null);
    assert.equal(
      await fs.readFile(out, "utf8"),
      `VCUIAcceptMapping(1 "analogLib/res" "personal" "${personal}")\n`,
    );
    await fs.writeFile(
      edit,
      JSON.stringify({
        version: 1,
        device: "analogLib/res",
        rule: { ...rule, symbol: "diode" },
      }),
    );
    const invalid = spawnSync(
      process.execPath,
      [...args.slice(0, 6), path.join(dir, "bad.il"), ...args.slice(7)],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /VCUI\|1\|ERROR\|apply\|UNSUPPORTED_SYMBOL/);
    assert.deepEqual(JSON.parse(await fs.readFile(personal, "utf8")), saved);
    await assert.rejects(fs.stat(path.join(dir, "bad.il")), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("adapter failure has an error frame and no result file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-test-"));
  try {
    const out = path.join(dir, "scan.il");
    const run = spawnSync(
      process.execPath,
      [command, "scan", path.join(dir, "missing.json"), "--out", out],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.equal(
      run.stdout,
      "VCUI|1|PROGRESS|scan\nVCUI|1|ERROR|scan|ENOENT\n",
    );
    await assert.rejects(fs.stat(out), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("export adapter merges session mappings and applies window options", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-export-"));
  try {
    const source = path.join(dir, "source.json"),
      session = path.join(dir, "session.json");
    const personal = path.join(dir, "personal.json"),
      result = path.join(dir, "result.il");
    const output = path.join(dir, "project");
    const projectFile = "resistor test.icproj.json";
    const rule = {
      symbol: "resistor",
      pins: { PLUS: "1", MINUS: "2" },
      parameters: { r: "r" },
      omitPins: [],
    };
    const data = fixture();
    data.instances[0].properties.push({
      name: "nlAction",
      type: "string",
      value: "ignore",
    });
    await fs.writeFile(source, JSON.stringify(data));
    await fs.writeFile(
      personal,
      JSON.stringify({ version: 1, devices: { "analogLib/res": null } }),
    );
    await fs.writeFile(
      session,
      JSON.stringify({ version: 1, devices: { "analogLib/res": rule } }),
    );
    const run = spawnSync(
      process.execPath,
      [
        command,
        "export",
        source,
        "--out",
        output,
        "--project-file",
        "resistor test",
        "--result",
        result,
        "--session",
        session,
        "--mappings",
        personal,
        "--scale",
        "140",
        "--bus-mode",
        "bundled",
        "--disabled-instances",
        "keep",
        "--isolated-ports",
        "omit",
        "--show-instance-names",
        "false",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          PYTHONHOME: "/invalid/cadence/python",
          PYTHONPATH: "/invalid/cadence/modules",
        },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "VCUI|1|PROGRESS|export\nVCUI|1|DONE|export\n");
    const response = await fs.readFile(result, "utf8");
    assert.match(
      response,
      /^VCUIAcceptExport\(1 "success(?:_with_warnings)?" /,
    );
    assert.match(response, /"resistor test.icproj.json" list\(/);
    assert.doesNotMatch(
      response,
      /"Symbol labels retain raw expressions|"Pin centers are geometric centers/,
    );
    const report = JSON.parse(
      await fs.readFile(path.join(output, "resistor test.report.json"), "utf8"),
    );
    assert.equal(report.options.scale, 140);
    assert.equal(report.options.busMode, "bundled");
    assert(Array.isArray(report.warnings));
    const project = JSON.parse(
      await fs.readFile(path.join(output, projectFile), "utf8"),
    );
    const instanceLabels = project.documents[0].annotations.filter(
      (annotation) =>
        annotation.kind === "instance-label" &&
        annotation.binding?.kind === "instance-reference",
    );
    assert(instanceLabels.length > 0);
    assert(instanceLabels.every((annotation) => annotation.visible === false));
    assert.deepEqual(JSON.parse(await fs.readFile(personal, "utf8")), {
      version: 1,
      devices: { "analogLib/res": null },
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("export validates unsaved power and ground names from the window", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "vc-skill-ui-net-export-"),
  );
  try {
    const source = path.join(dir, "source.json"),
      session = path.join(dir, "session.json");
    const result = path.join(dir, "result.il"),
      output = path.join(dir, "project");
    await fs.writeFile(source, JSON.stringify(fixture()));
    await fs.writeFile(session, JSON.stringify({ version: 1, devices: {} }));
    const run = spawnSync(
      process.execPath,
      [
        command,
        "export",
        source,
        "--out",
        output,
        "--project-file",
        "design",
        "--result",
        result,
        "--session",
        session,
        "--scale",
        "140",
        "--bus-mode",
        "bundled",
        "--disabled-instances",
        "keep",
        "--isolated-ports",
        "omit",
        "--show-instance-names",
        "true",
        "--power-nets",
        "VDD GND",
        "--ground-nets",
        "GND",
      ],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(run.status, 1);
    assert.match(run.stdout, /VCUI\|1\|ERROR\|export\|INVALID_CONFIG/);
    assert.match(
      await fs.readFile(result, "utf8"),
      /VCUIAcceptExportError\(1 "INVALID_CONFIG"/,
    );
    await assert.rejects(fs.stat(path.join(output, "design.icproj.json")), {
      code: "ENOENT",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("one save directory accepts distinct project filenames but refuses overwrite", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-existing-"));
  try {
    const source = path.join(dir, "source.json"),
      session = path.join(dir, "session.json");
    const result = path.join(dir, "result.il"),
      output = path.join(dir, "project");
    await fs.writeFile(source, JSON.stringify(fixture()));
    await fs.writeFile(session, JSON.stringify({ version: 1, devices: {} }));
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, "keep.txt"), "unchanged");
    const args = [
      command,
      "export",
      source,
      "--out",
      output,
      "--project-file",
      "design.icproj.json",
      "--result",
      result,
      "--session",
      session,
      "--scale",
      "140",
      "--bus-mode",
      "bundled",
      "--disabled-instances",
      "keep",
      "--isolated-ports",
      "omit",
      "--show-instance-names",
      "true",
    ];
    const run = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(run.status, 0, run.stderr);
    const first = await fs.readFile(
      path.join(output, "design.icproj.json"),
      "utf8",
    );
    assert(
      JSON.parse(
        await fs.readFile(path.join(output, "design.report.json"), "utf8"),
      ),
    );
    const second = spawnSync(
      process.execPath,
      args.map((value) =>
        value === "design.icproj.json"
          ? "other.icproj.json"
          : value === result
            ? path.join(dir, "other.il")
            : value,
      ),
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(second.status, 0, second.stderr);
    assert(
      JSON.parse(
        await fs.readFile(path.join(output, "other.icproj.json"), "utf8"),
      ),
    );
    assert(
      JSON.parse(
        await fs.readFile(path.join(output, "other.report.json"), "utf8"),
      ),
    );
    const duplicate = spawnSync(
      process.execPath,
      args.map((value) =>
        value === result ? path.join(dir, "duplicate.il") : value,
      ),
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(duplicate.status, 1);
    assert.equal(
      duplicate.stdout,
      "VCUI|1|PROGRESS|export\nVCUI|1|ERROR|export|OUTPUT_EXISTS\n",
    );
    assert.match(
      await fs.readFile(path.join(dir, "duplicate.il"), "utf8"),
      /File already exists:/,
    );
    assert.equal(
      await fs.readFile(path.join(output, "design.icproj.json"), "utf8"),
      first,
    );
    const replace = spawnSync(
      process.execPath,
      [
        ...args.map((value) =>
          value === result
            ? path.join(dir, "replace.il")
            : value === "140"
              ? "160"
              : value,
        ),
        "--replace",
        "true",
      ],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(replace.status, 0, replace.stderr);
    assert.notEqual(
      await fs.readFile(path.join(output, "design.icproj.json"), "utf8"),
      first,
    );
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(output, "design.report.json"), "utf8"),
      ).options.scale,
      160,
    );
    assert(
      JSON.parse(
        await fs.readFile(path.join(output, "other.icproj.json"), "utf8"),
      ),
    );
    assert.equal(
      await fs.readFile(path.join(output, "keep.txt"), "utf8"),
      "unchanged",
    );
    await assert.rejects(fs.stat(path.join(output, "design.failed")), {
      code: "ENOENT",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("export adapter returns the conversion code and never publishes a project on failure", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "vc-skill-ui-export-fail-"),
  );
  try {
    const source = path.join(dir, "source.json"),
      session = path.join(dir, "session.json");
    const result = path.join(dir, "result.il"),
      output = path.join(dir, "project");
    const data = fixture();
    data.nets[0].numBits = 2;
    await fs.writeFile(source, JSON.stringify(data));
    await fs.writeFile(session, JSON.stringify({ version: 1, devices: {} }));
    const run = spawnSync(
      process.execPath,
      [
        command,
        "export",
        source,
        "--out",
        output,
        "--project-file",
        "design.icproj.json",
        "--result",
        result,
        "--session",
        session,
        "--scale",
        "140",
        "--bus-mode",
        "reject",
        "--disabled-instances",
        "keep",
        "--isolated-ports",
        "omit",
        "--show-instance-names",
        "true",
      ],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(run.status, 1);
    assert.equal(
      run.stdout,
      "VCUI|1|PROGRESS|export\nVCUI|1|ERROR|export|BUS_UNSUPPORTED\n",
    );
    const response = await fs.readFile(result, "utf8");
    assert.match(response, /^VCUIAcceptExportError\(1 "BUS_UNSUPPORTED" /);
    assert.match(response, /must be expanded explicitly/);
    await assert.rejects(fs.stat(path.join(output, "design.icproj.json")), {
      code: "ENOENT",
    });
    const failure = JSON.parse(
      await fs.readFile(
        path.join(output, "design.failed", "error.json"),
        "utf8",
      ),
    );
    assert.equal(failure.error.code, "BUS_UNSUPPORTED");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("approved replacement keeps the old project when conversion fails", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "vc-skill-ui-replace-fail-"),
  );
  try {
    const source = path.join(dir, "source.json"),
      session = path.join(dir, "session.json");
    const result = path.join(dir, "result.il"),
      output = path.join(dir, "saved");
    const data = fixture();
    data.nets[0].numBits = 2;
    await fs.writeFile(source, JSON.stringify(data));
    await fs.writeFile(session, JSON.stringify({ version: 1, devices: {} }));
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, "design.icproj.json"), "old project");
    await fs.writeFile(path.join(output, "design.report.json"), "old report");
    const run = spawnSync(
      process.execPath,
      [
        command,
        "export",
        source,
        "--out",
        output,
        "--project-file",
        "design",
        "--result",
        result,
        "--session",
        session,
        "--scale",
        "140",
        "--bus-mode",
        "reject",
        "--disabled-instances",
        "keep",
        "--isolated-ports",
        "omit",
        "--show-instance-names",
        "true",
        "--replace",
        "true",
      ],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(run.status, 1);
    assert.match(await fs.readFile(result, "utf8"), /"BUS_UNSUPPORTED"/);
    assert.equal(
      await fs.readFile(path.join(output, "design.icproj.json"), "utf8"),
      "old project",
    );
    assert.equal(
      await fs.readFile(path.join(output, "design.report.json"), "utf8"),
      "old report",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("project filename cannot escape its output directory", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vc-skill-ui-file-"));
  try {
    const source = path.join(dir, "source.json"),
      session = path.join(dir, "session.json");
    const result = path.join(dir, "result.il"),
      output = path.join(dir, "project");
    await fs.writeFile(source, JSON.stringify(fixture()));
    await fs.writeFile(session, JSON.stringify({ version: 1, devices: {} }));
    const run = spawnSync(
      process.execPath,
      [
        command,
        "export",
        source,
        "--out",
        output,
        "--project-file",
        "../escape.icproj.json",
        "--result",
        result,
        "--session",
        session,
        "--scale",
        "140",
        "--bus-mode",
        "reject",
        "--disabled-instances",
        "keep",
        "--isolated-ports",
        "omit",
        "--show-instance-names",
        "true",
      ],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(run.status, 1);
    assert.match(
      await fs.readFile(result, "utf8"),
      /VCUIAcceptExportError\(1 "ARGUMENT_ERROR"/,
    );
    await assert.rejects(fs.stat(output), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
