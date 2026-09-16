import { describe, expect, it } from "vitest";
import { vacaskProcessFailure } from "./vacask-process-failure.mjs";

describe("VACASK qualification failure evidence", () => {
  it("retains stdout-only model errors rather than returning an empty message", () => {
    expect(
      vacaskProcessFailure({
        status: 1,
        stdout: "Master 'resistor' not found.\n99:1 in models_resistors.scs\n",
        stderr: "",
      }),
    ).toBe(
      "exit 1\nMaster 'resistor' not found.\n99:1 in models_resistors.scs",
    );
  });

  it("retains both diagnostic streams when a process times out", () => {
    const message = vacaskProcessFailure({
      status: null,
      signal: "SIGTERM",
      error: new Error("spawnSync ETIMEDOUT"),
      stderr: "failed iteration\n",
      stdout: "Running analysis op\n",
    });
    expect(message).toBe(
      "spawnSync ETIMEDOUT\nsignal SIGTERM\nfailed iteration\nRunning analysis op",
    );
  });

  it("keeps misleading compiler exit zero alongside its linker error", () => {
    expect(
      vacaskProcessFailure({
        status: 0,
        stderr: "linker not found",
        stdout: "",
      }),
    ).toBe("exit 0\nlinker not found");
  });

  it("reports process identity when there is no textual diagnostic", () => {
    expect(vacaskProcessFailure({ status: 1, stdout: "", stderr: "" })).toBe(
      "exit 1",
    );
    expect(
      vacaskProcessFailure({ error: new Error("ENOENT"), status: null }),
    ).toBe("ENOENT\nexit unknown");
  });
});
