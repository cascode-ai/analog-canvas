import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { inspectVacaskModelArtifact } from "../containers/vacask/model-symbols.mjs";

// Provisioning helper for a flattened native model artifact, not a deck
// converter or environment registration. Multi-file libraries must first use
// their existing packaging workflow; missing includes are errors, not omitted.
const { values } = parseArgs({
  options: {
    library: { type: "string" },
    "dependency-id": { type: "string" },
    master: { type: "string", multiple: true },
    section: { type: "string" },
    output: { type: "string" },
  },
});
if (
  !values.library ||
  !values["dependency-id"] ||
  !values.master?.length ||
  !values.output ||
  values.master.length > 256 ||
  (values.section !== undefined &&
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(values.section))
)
  throw Error(
    "Use --library <flat native file> --dependency-id <id> --master <name> [--master <name> ...] [--section <section>] --output <new JSON file>",
  );
const inspected = await inspectVacaskModelArtifact(
  values.library,
  values.master,
  values.section,
);
const report = {
  status: "derived-not-qualified",
  unresolved: values.master.filter(
    (name) =>
      !inspected.masters.some((m) => m.name === name && m.primitives.length),
  ),
  library: {
    dependencyId: values["dependency-id"],
    sha256: inspected.sha256,
    ...(values.section === undefined ? {} : { section: values.section }),
    masters: inspected.masters,
  },
};
writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    output: values.output,
    status: report.status,
    unresolved: report.unresolved,
  }),
);
