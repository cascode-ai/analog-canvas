import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseNgspiceRawfile, type RawfileParse } from "./rawfile.js";

/**
 * The three fixtures under `fixtures/ngspice-rawfile/` were written by
 * ngspice 46, each beside the deck that produced it. Nothing here compares the
 * parser against its own output: the structural expectations come from the
 * bytes the simulator wrote, and every numeric expectation is either a literal
 * that can be read out of the fixture by eye or, in `result-data.test.ts`,
 * arithmetic the circuit has a closed-form answer for.
 */
function fixture(name: string): string {
  return readFileSync(
    new URL(`../../../fixtures/ngspice-rawfile/${name}`, import.meta.url),
    "utf8",
  );
}

function expectError(parse: RawfileParse) {
  if (parse.ok) {
    throw new Error(
      `Expected a diagnostic, but the parse succeeded with ${parse.plots.length} plots.`,
    );
  }
  return parse.error;
}

function expectPlots(parse: RawfileParse) {
  if (!parse.ok) {
    throw new Error(`Expected a parse, but got: ${parse.error.message}`);
  }
  return parse.plots;
}

/** Index of the `Values:` line, so a test can edit the value block only. */
function valuesLine(lines: readonly string[]): number {
  const index = lines.findIndex((line) => /^\s*Values:/u.test(line));
  expect(index).toBeGreaterThan(0);
  return index;
}

describe("the header ngspice writes", () => {
  it("reads the operating-point plot's declared shape", () => {
    const plots = expectPlots(parseNgspiceRawfile(fixture("divider-op.raw")));
    expect(plots).toHaveLength(1);
    const plot = plots[0]!;
    expect(plot.plotName).toBe("Operating Point");
    expect(plot.flags).toEqual(["real"]);
    expect(plot.complex).toBe(false);
    expect(plot.pointCount).toBe(1);
    expect(plot.command).toBe("ngspice-46, Build");
    expect(
      plot.vectors.map((vector) => [
        vector.variable.index,
        vector.variable.name,
        vector.variable.quantity,
      ]),
    ).toEqual([
      [0, "v(in)", "voltage"],
      [1, "v(mid)", "voltage"],
      [2, "i(v1)", "current"],
    ]);
    // A real plot reports no imaginary part rather than a column of zeros, so
    // an absent one can never be mistaken for a measured one.
    expect(plot.vectors.map((vector) => vector.imag)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("keeps a variable's trailing qualifiers instead of dropping them", () => {
    const plots = expectPlots(parseNgspiceRawfile(fixture("rc-ac.raw")));
    const frequency = plots[0]!.vectors[0]!.variable;
    expect(frequency.name).toBe("frequency");
    expect(frequency.quantity).toBe("frequency");
    expect(frequency.qualifiers).toEqual(["grid=3"]);
  });
});

describe("the blank line between points", () => {
  it("recovers every point of the complex plot, both parts", () => {
    const plot = expectPlots(parseNgspiceRawfile(fixture("rc-ac.raw")))[0]!;
    expect(plot.complex).toBe(true);
    expect(plot.pointCount).toBe(17);
    expect(plot.vectors).toHaveLength(4);
    for (const vector of plot.vectors) {
      expect(vector.real).toHaveLength(17);
      expect(vector.imag).toHaveLength(17);
    }
  });

  it("rejects a file whose points were run together", () => {
    // Deleting one blank line joins two points into an eight-line block. A
    // reader that advances a fixed number of lines per point cannot see the
    // difference; splitting on the blank line and counting can, and the count
    // is what makes it an error rather than a shorter answer.
    const lines = fixture("rc-ac.raw").split("\n");
    const start = valuesLine(lines);
    const blank = lines.findIndex(
      (line, index) => index > start && line.trim().length === 0,
    );
    lines.splice(blank, 1);

    const error = expectError(parseNgspiceRawfile(lines.join("\n")));
    expect(error.code).toBe("point-count-mismatch");
    expect(error.message).toContain("declares 17 points");
    expect(error.message).toContain("holds 16");
  });

  it("rejects a file with a blank line inside a point", () => {
    const lines = fixture("rc-tran.raw").split("\n");
    lines.splice(valuesLine(lines) + 2, 0, "");

    const error = expectError(parseNgspiceRawfile(lines.join("\n")));
    expect(error.code).toBe("point-count-mismatch");
    expect(error.message).toContain("holds 80");
  });

  it("rejects a truncated file rather than reporting the points it has", () => {
    const text = fixture("rc-ac.raw");
    const cut = text.indexOf("\n 11\t");
    expect(cut).toBeGreaterThan(0);
    const error = expectError(parseNgspiceRawfile(text.slice(0, cut + 1)));
    expect(error.code).toBe("point-count-mismatch");
    expect(error.message).toContain("holds 11");
  });

  it("rejects a point that is short one value", () => {
    // The blank lines still separate 79 points, so only the block's own
    // length can catch this. Nothing is padded to fill the gap.
    const lines = fixture("rc-tran.raw").split("\n");
    lines.splice(valuesLine(lines) + 3, 1);

    const error = expectError(parseNgspiceRawfile(lines.join("\n")));
    expect(error.code).toBe("point-block-invalid");
    expect(error.message).toBe(
      "Point 0 holds 3 values but the plot declares 4 variables.",
    );
  });

  it("rejects points that are out of order", () => {
    const text = fixture("rc-tran.raw").replace("\n 5\t", "\n 6\t");
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("point-block-invalid");
    expect(error.message).toContain("numbered 6");
  });
});

describe("values a run cannot use", () => {
  it("names the variable and line of a non-finite value", () => {
    const text = fixture("rc-tran.raw").replace(
      "\t9.999999900000004e-11",
      "\tnan",
    );
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("value-not-finite");
    expect(error.message).toContain('"v(out)" at point 1');
    expect(error.message).toContain("did not converge");
    expect(error.line).toBe(21);
  });

  it("rejects an infinity as firmly as a NaN", () => {
    const text = fixture("divider-op.raw").replace(
      "\t5.000000000000000e-01",
      "\t-inf",
    );
    expect(expectError(parseNgspiceRawfile(text)).code).toBe(
      "value-not-finite",
    );
  });

  it("rejects a decimal that overflows a double", () => {
    const text = fixture("divider-op.raw").replace(
      "\t5.000000000000000e-01",
      "\t1e999",
    );
    expect(expectError(parseNgspiceRawfile(text)).code).toBe(
      "value-not-finite",
    );
  });

  it("rejects a value that is not a number at all", () => {
    const text = fixture("divider-op.raw").replace(
      "\t5.000000000000000e-01",
      "\tconverged",
    );
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("value-malformed");
    expect(error.message).toContain('"v(mid)" at point 0');
  });

  it("rejects a complex value that lost a part", () => {
    const text = fixture("rc-ac.raw").replace(
      "\t9.999605231408795e-01,-6.282937266758386e-03",
      "\t9.999605231408795e-01",
    );
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("value-malformed");
    expect(error.message).toContain('"real,imaginary"');
  });
});

describe("files that are not a readable rawfile", () => {
  it("says an empty file produced no vectors", () => {
    for (const text of ["", "   ", "\n\n\n"]) {
      const error = expectError(parseNgspiceRawfile(text));
      expect(error.code).toBe("empty-file");
      expect(error.message).toContain("no vectors");
    }
  });

  it("says a binary rawfile needs `set filetype=ascii`", () => {
    const text = fixture("divider-op.raw").replace(
      /Values:[\s\S]*$/u,
      "Binary:\n ",
    );
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("unsupported-format");
    expect(error.message).toContain("filetype=ascii");
  });

  it("refuses ngspice's log where a rawfile was expected", () => {
    const error = expectError(
      parseNgspiceRawfile("Circuit: * divider\n\nNo. of Data Rows : 1\n"),
    );
    expect(error.code).toBe("unsupported-format");
    expect(error.message).toContain("does not look like an ngspice rawfile");
  });

  it("reports a header that stops before its variables", () => {
    const text = fixture("divider-op.raw");
    const error = expectError(
      parseNgspiceRawfile(text.slice(0, text.indexOf("\nVariables:"))),
    );
    expect(error.code).toBe("header-incomplete");
    expect(error.message).toContain("ends before its `Variables:` block");
  });

  it("reports a header line the file was cut in half through", () => {
    const text = fixture("divider-op.raw");
    const error = expectError(
      parseNgspiceRawfile(text.slice(0, text.indexOf("Variables: 3") + 4)),
    );
    expect(error.code).toBe("header-invalid");
    expect(error.message).toContain('is not a "Key: value" line');
  });

  it("reports a `Variables:` block shorter than the header claims", () => {
    const text = fixture("divider-op.raw").replace("\t2\ti(v1)\tcurrent\n", "");
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("header-incomplete");
    expect(error.message).toContain("declares 3 variables");
    expect(error.message).toContain("lists 2");
  });

  it("reports a header missing the point count", () => {
    const text = fixture("divider-op.raw").replace("No. Points: 1\n", "");
    const error = expectError(parseNgspiceRawfile(text));
    expect(error.code).toBe("header-invalid");
    expect(error.message).toContain("No. Points");
  });
});

describe("more than one plot in one file", () => {
  it("reads plots written back to back, keeping each one's own points", () => {
    // Exactly what ngspice writes when a `.control` block writes twice: one
    // plot's trailing blank line, then the next plot's `Title:`.
    const plots = expectPlots(
      parseNgspiceRawfile(fixture("divider-op.raw") + fixture("rc-tran.raw")),
    );
    expect(plots.map((plot) => plot.plotName)).toEqual([
      "Operating Point",
      "Transient Analysis",
    ]);
    expect(plots.map((plot) => plot.vectors[0]!.real.length)).toEqual([1, 79]);
    // The second plot's own numbers, not a continuation of the first's.
    const time = plots[1]!.vectors[0]!.real;
    expect(time[0]).toBe(0);
    expect(time[78]).toBe(0.004);
    expect(plots[0]!.vectors[1]!.real).toEqual([0.5]);
  });

  it("reports a mismatch in a later plot, not only the first", () => {
    const damaged = fixture("rc-tran.raw").replace(
      "No. Points: 79",
      "No. Points: 80",
    );
    const error = expectError(
      parseNgspiceRawfile(fixture("divider-op.raw") + damaged),
    );
    expect(error.code).toBe("point-count-mismatch");
    expect(error.message).toContain("declares 80 points");
  });
});
