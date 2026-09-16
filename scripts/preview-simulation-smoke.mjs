/**
 * Preview's numerical simulation smoke.
 *
 * Public test helpers remain exported here; implementation is split by
 * qualification inputs, result validation, and hosted run orchestration.
 */
import { pathToFileURL } from "node:url";

import { EXECUTORS, profile } from "./lib/preview-simulation-qualification.mjs";
import {
  runHostedSky130Acceptance,
  runHostedSky130CornerAcceptance,
  runHostedSky130ExtendedDeviceAcceptance,
  runHostedSky130NoiseAcceptance,
  runHostedSky130TransientAcceptance,
  runPreviewDcSmoke,
  runPreviewResistorNoiseSmoke,
  runPreviewSimulationSmoke,
  runPreviewTransientSmoke,
  validateExecutorParity,
} from "./lib/preview-simulation-runs.mjs";

export {
  compileHostedSky130NoiseProject,
  compileHostedSky130Project,
  compileHostedSky130TransientProject,
  DIVIDER_DC_REQUEST,
  DIVIDER_REQUEST,
  hostedSky130CornerRequest,
  hostedSky130ExtendedDeviceRequest,
  RC_TRAN_REQUEST,
  RESISTOR_NOISE_REQUEST,
} from "./lib/preview-simulation-qualification.mjs";
export {
  validateDcDividerResult,
  validatePreviewSimulationResult,
  validateRcTransientResult,
  validateResistorNoiseResult,
} from "./lib/preview-simulation-validation.mjs";
export {
  validateHostedSky130CornerResult,
  validateHostedSky130ExtendedDeviceResult,
  validateHostedSky130NoiseResult,
  validateHostedSky130Result,
  validateHostedSky130TransientResult,
} from "./lib/preview-simulation-sky130-validation.mjs";
export {
  runHostedSky130Acceptance,
  runHostedSky130CornerAcceptance,
  runHostedSky130ExtendedDeviceAcceptance,
  runHostedSky130NoiseAcceptance,
  runHostedSky130TransientAcceptance,
  runPreviewDcSmoke,
  runPreviewResistorNoiseSmoke,
  runPreviewSimulationSmoke,
  runPreviewTransientSmoke,
  validateExecutorParity,
} from "./lib/preview-simulation-runs.mjs";
async function main() {
  const baseUrl = process.argv[2];
  const scope = process.argv[3] ?? "--full";
  if (!baseUrl) {
    throw new Error(
      "usage: node scripts/preview-simulation-smoke.mjs https://preview.example [--full|--production-smoke]",
    );
  }
  if (scope !== "--full" && scope !== "--production-smoke") {
    throw new Error(`Unknown simulation smoke scope: ${scope}`);
  }
  const results = [];
  for (const target of EXECUTORS) {
    const result = await runPreviewSimulationSmoke({ baseUrl, target });
    results.push(result);
    console.log(
      `${result.target}: v(mid)=${result.value}, ${result.simulatorVersion}, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(results);
  console.log("Preview executor parity: passed");

  for (const target of EXECUTORS) {
    const result = await runPreviewTransientSmoke({ baseUrl, target });
    console.log(`${result.target}: RC TRAN ${result.pointCount} points passed`);
  }

  for (const target of EXECUTORS) {
    const result = await runPreviewDcSmoke({ baseUrl, target });
    console.log(
      `${result.target}: divider DC ${result.pointCount} points passed`,
    );
  }

  for (const target of EXECUTORS) {
    const result = await runPreviewResistorNoiseSmoke({ baseUrl, target });
    console.log(
      `${result.target}: resistor Noise ${result.pointCount} points passed`,
    );
  }

  // Preview owns the complete hosted-model qualification. Production serves
  // the exact candidate Preview accepted, so promotion only needs to prove
  // that its independently configured simulation route still executes each
  // baseline analysis. Keeping this path dependency-free is deliberate: the
  // promotion job does not reinstall or rebuild the workspace.
  if (scope === "--production-smoke") {
    console.log("Production numerical smoke: passed");
    return;
  }

  const qualifications = [];
  for (const target of EXECUTORS) {
    const result = await runHostedSky130Acceptance({ baseUrl, target });
    qualifications.push(result);
    console.log(
      `${result.target}: ${result.fixtureId} passed, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(qualifications);
  for (const target of EXECUTORS) {
    const result = await runHostedSky130TransientAcceptance({
      baseUrl,
      target,
    });
    console.log(
      `${result.target}: SKY130 OTA TRAN ${result.pointCount} points passed`,
    );
  }
  for (const target of EXECUTORS) {
    const result = await runHostedSky130NoiseAcceptance({ baseUrl, target });
    console.log(
      `${result.target}: SKY130 OTA Noise ${result.pointCount} points passed ` +
        `(onoise=${result.integratedOutputNoise}, inoise=${result.integratedInputNoise})`,
    );
  }
  for (const target of EXECUTORS) {
    for (const corner of profile.qualifiedScope.sections) {
      const result = await runHostedSky130CornerAcceptance({
        baseUrl,
        target,
        corner,
      });
      console.log(
        `${target}: SKY130 ${result.corner.toUpperCase()} corner passed ` +
          `(NFET=${result.nfetCurrentA}, PFET=${result.pfetSourceCurrentA})`,
      );
      const extended = await runHostedSky130ExtendedDeviceAcceptance({
        baseUrl,
        target,
        corner,
      });
      console.log(
        `${target}: SKY130 ${extended.corner.toUpperCase()} extended devices passed`,
      );
    }
  }
  console.log(`Hosted SKY130 Profile ${profile.id}: qualified`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
