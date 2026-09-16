import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

// Reference acquisition must expose sampling: ngspice's source-by-source
// integrated noise is not the same quantity as a sampled total-PSD estimate.
export function otaReferenceDeck({
  circuit,
  testbench,
  corner,
  noisePointsPerDecade = 20,
  noiseSourceDetails = false,
}) {
  if (!Number.isSafeInteger(noisePointsPerDecade) || noisePointsPerDecade < 1)
    throw Error("Noise points per decade must be a positive safe integer");
  return `Independent OTA BSIM4 4.8.3 ${corner}
.lib "../models/sky130.lib.spice" ${corner}
${circuit}
${testbench}
.options reltol=1e-8 abstol=1e-12 vntol=1e-10
.control
set filetype=ascii
op
write op.raw v(vout) v(ibias) v(xdut.tail) v(xdut.nleft)
dc VINP 0.88 0.92 0.005
write dc.raw v(vout) v(ibias) v(xdut.tail) v(xdut.nleft)
ac dec 10 1 1g
write ac.raw v(vout) v(ibias) v(xdut.tail) v(xdut.nleft)
tran 20n 4u 0 2n
write tran.raw v(vout) v(ibias) v(xdut.tail) v(xdut.nleft)
noise v(vout) VINP dec ${noisePointsPerDecade} 1 1g${noiseSourceDetails ? " 1" : ""}
setplot noise1
write noise.raw ${noiseSourceDetails ? "all" : "onoise_spectrum inoise_spectrum"}
setplot noise2
write integrated.raw ${noiseSourceDetails ? "all" : "onoise_total inoise_total"}
quit
.endc
.end
`;
}

// Same byte identity convention as the historical hosted Profile. Reference
// acquisition is local/read-only; this helper is never a product executor.
export function referenceModelTreeSha256(root) {
  const hash = createHash("sha256");
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile())
        throw Error(`Reference model tree contains a non-file: ${path}`);
      const bytes = readFileSync(path);
      hash.update(JSON.stringify(relative(root, path).replaceAll("\\", "/")));
      hash.update("\0" + bytes.byteLength + "\0");
      hash.update(bytes);
      hash.update("\0");
    }
  };
  visit(root);
  return hash.digest("hex");
}

// Applied only after exact original-tree verification. Preserve every other
// source byte, including comments, model coefficients and continuation layout.
export function upgradeReferenceModelVersions(text) {
  const counts = {};
  const upgraded = text.replace(
    /^(?![ \t]*\*)[^\r\n]*\bversion[ \t]*=[ \t]*[^\r\n]*/gimu,
    (line) =>
      line.replace(
        /\bversion\s*=\s*(\d+(?:\.\d+)+)(?=\s|$)/giu,
        (assignment, version) => {
          if (!["4.5", "4.62"].includes(version))
            throw Error(`Unexpected reference BSIM version: ${version}`);
          counts[version] = (counts[version] ?? 0) + 1;
          return assignment.replace(version, "4.8.3");
        },
      ),
  );
  return { text: upgraded, counts };
}
