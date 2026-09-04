import { pathToFileURL } from "node:url";

export const deck = [
  "V1 in 0 DC 1",
  "R1 in mid 1k",
  "R2 mid 0 1k",
  ".control",
  "set filetype=ascii",
  "op",
  "write out.raw v(mid)",
  ".endc",
  ".end",
].join("\n");

export function readMidpoint(rawfile) {
  const variable = /^\s*(\d+)\s+v\(mid\)\s+\S+/mu.exec(rawfile);
  const valuesAt = rawfile.search(/^\s*Values:\s*$/mu);
  if (!variable || valuesAt < 0) {
    throw new Error(
      "the numerical smoke rawfile has no v(mid) operating-point value",
    );
  }
  const values = rawfile
    .slice(valuesAt)
    .split(/\r?\n/u)
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => Number(line.trim().split(/\s+/u).at(-1)));
  const midpoint = values[Number(variable[1])];
  if (!Number.isFinite(midpoint) || Math.abs(midpoint - 0.5) > 1e-12) {
    throw new Error(
      `the numerical smoke solved v(mid) as ${midpoint}, expected 0.5`,
    );
  }
  return midpoint;
}

export async function runNumericalSmoke({
  fetchImpl = fetch,
  token = process.env.SIMULATION_ACCESS_TOKEN,
} = {}) {
  if (!token) throw new Error("the container has no simulation access token");

  const response = await fetchImpl("http://127.0.0.1:8080/run", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ deck, timeoutMs: 30_000 }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`run ${response.status}: ${text}`);

  const result = JSON.parse(text);
  if (result.timedOut === true) {
    throw new Error("the numerical smoke timed out");
  }
  if (result.rawfileFormat !== "ascii" || typeof result.rawfile !== "string") {
    throw new Error(
      `the numerical smoke returned no ASCII rawfile: ${result.log ?? "no log"}`,
    );
  }

  return readMidpoint(result.rawfile);
}

if (
  process.argv[1] === undefined ||
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const midpoint = await runNumericalSmoke();
  process.stdout.write(`numerical smoke: v(mid)=${midpoint}`);
}
