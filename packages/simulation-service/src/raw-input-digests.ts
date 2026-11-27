import type { ExecutionInput } from "./executor.js";

const utf8Encoder = new TextEncoder();

/**
 * Return a copy of `input` with raw `netlist` (drawn circuit files) and
 * `testbench` (authored testbench files) digest texts populated (#1243, #1407).
 *
 * Raw runs execute the entry deck and its `files` alone; these fields feed
 * only the run's input metadata (`netlistSha256`, `testbenchSha256`) and
 * prepared digest. Each copy is attached only while the whole serialized input
 * stays within `maxInputBytes`, falling back to `""` / `preparedDeck`.
 */
export function withRawExecutionInputDigestTexts(
  input: ExecutionInput & { preparedDeck: string },
  generatedPaths: ReadonlySet<string>,
  maxInputBytes: number,
): ExecutionInput & { preparedDeck: string } {
  const base: ExecutionInput & { preparedDeck: string } = {
    ...input,
    netlist: "",
    testbench: input.preparedDeck,
  };
  if (!base.preparedDeck) return base;
  const fitsInputBudget = (candidate: ExecutionInput) =>
    utf8Encoder.encode(JSON.stringify(candidate)).length <= maxInputBytes;
  const drawnCircuit = base.files
    .filter((file) => generatedPaths.has(file.path))
    .map((file) => file.text)
    .join("\n");
  const withNetlist =
    drawnCircuit && fitsInputBudget({ ...base, netlist: drawnCircuit })
      ? { ...base, netlist: drawnCircuit }
      : base;
  const authoredTestbench = base.files
    .filter((file) => !generatedPaths.has(file.path))
    .map((file) => file.text)
    .join("\n");
  if (
    authoredTestbench &&
    authoredTestbench !== base.preparedDeck &&
    fitsInputBudget({ ...withNetlist, testbench: authoredTestbench })
  )
    return { ...withNetlist, testbench: authoredTestbench };
  return withNetlist;
}
