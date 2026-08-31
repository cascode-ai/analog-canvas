// Re-fetch the gallery red-line corpus snapshots (fixtures/gallery-redline/).
// See that directory's README for what the corpus is and why these six ids.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://analog-canvas.tokenzhang.com/api/gallery";
const IDS = [
  "ycg43babwa",
  "3tfmrzevfe",
  "b5cn37k3a9",
  "2rmm2vb45f",
  "7sxpwb4am7",
  "f22q5vhdb5",
];

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "gallery-redline",
);
await mkdir(out, { recursive: true });
for (const id of IDS) {
  const response = await fetch(`${BASE}/${id}`, {
    headers: { "user-agent": "icm-redline-corpus-refresh" },
  });
  if (!response.ok) {
    throw new Error(
      `${id}: HTTP ${response.status} — see fixtures/gallery-redline/README.md before swapping ids`,
    );
  }
  const payload = await response.json();
  await writeFile(join(out, `${id}.icproj.json`), payload.projectText);
  console.log(`refreshed ${id} (${payload.entry?.name ?? "?"})`);
}
