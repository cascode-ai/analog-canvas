import {
  compileHostedSky130NoiseProject,
  compileHostedSky130Project,
  compileHostedSky130TransientProject,
  DIVIDER_DC_REQUEST,
  DIVIDER_REQUEST,
  hostedSky130CornerRequest,
  hostedSky130DiodeRequest,
  hostedSky130ExtendedDeviceRequest,
  hostedSky130HvtPfetRequest,
  hostedSky130LargePnpRequest,
  hostedSky130NpnRequest,
  hostedSky130Mos5vRequest,
  RC_TRAN_REQUEST,
  REQUEST_ERRORS,
  RESISTOR_NOISE_REQUEST,
} from "./preview-simulation-qualification.mjs";
import {
  validateDcDividerResult,
  validatePreviewSimulationResult,
  validateRcTransientResult,
  validateResistorNoiseResult,
} from "./preview-simulation-validation.mjs";
import { object } from "./preview-simulation-validation-core.mjs";
import { simulationSmokeHeaders } from "./simulation-smoke-headers.mjs";
import {
  validateHostedSky130CornerResult,
  validateHostedSky130DiodeResult,
  validateHostedSky130ExtendedDeviceResult,
  validateHostedSky130HvtPfetResult,
  validateHostedSky130LargePnpResult,
  validateHostedSky130NpnResult,
  validateHostedSky130Mos5vResult,
  validateHostedSky130NoiseResult,
  validateHostedSky130Result,
  validateHostedSky130TransientResult,
} from "./preview-simulation-sky130-validation.mjs";
export async function runHostedSky130Acceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130Project();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...compiled.request,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[protocol:non-json] ${target} model qualification answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    const refusal = object(payload, "simulation refusal");
    throw new Error(
      `[infrastructure:${String(refusal.error ?? `http-${response.status}`)}] ${target} model qualification answered HTTP ${response.status}`,
    );
  }
  return validateHostedSky130Result(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
    compiled.request,
  );
}

export async function runHostedSky130CornerAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130CornerRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} corner qualification failed.`,
    );
  return validateHostedSky130CornerResult(payload, target, corner);
}

export async function runHostedSky130HvtPfetAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130HvtPfetRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} high-Vt PFET qualification failed.`,
    );
  return validateHostedSky130HvtPfetResult(payload, target, corner);
}

export async function runHostedSky130Mos5vAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130Mos5vRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} 5 V MOS qualification failed.`,
    );
  return validateHostedSky130Mos5vResult(payload, target, corner);
}

export async function runHostedSky130LargePnpAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130LargePnpRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} 3.4 um PNP qualification failed.`,
    );
  return validateHostedSky130LargePnpResult(payload, target, corner);
}

export async function runHostedSky130NpnAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130NpnRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} 5 V NPN qualification failed.`,
    );
  return validateHostedSky130NpnResult(payload, target, corner);
}

export async function runHostedSky130DiodeAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130DiodeRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} diode qualification failed.`,
    );
  return validateHostedSky130DiodeResult(payload, target, corner);
}

export async function runHostedSky130ExtendedDeviceAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...hostedSky130ExtendedDeviceRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} extended-device qualification failed.`,
    );
  return validateHostedSky130ExtendedDeviceResult(payload, target, corner);
}

export async function runHostedSky130TransientAcceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130TransientProject();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({ ...compiled.request, executorTarget: target }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} TRAN qualification failed.`,
    );
  }
  return validateHostedSky130TransientResult(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
    compiled.request,
  );
}

export async function runHostedSky130NoiseAcceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130NoiseProject();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({ ...compiled.request, executorTarget: target }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} Noise qualification failed.`,
    );
  return validateHostedSky130NoiseResult(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
    compiled.request,
  );
}

export async function runPreviewResistorNoiseSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...RESISTOR_NOISE_REQUEST,
      inputRevision: `preview-resistor-noise-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} resistor Noise smoke failed.`,
    );
  return validateResistorNoiseResult(payload, target);
}

export async function runPreviewTransientSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...RC_TRAN_REQUEST,
      inputRevision: `preview-rc-tran-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} RC TRAN smoke failed.`,
    );
  }
  return validateRcTransientResult(payload, target);
}

export async function runPreviewDcSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...DIVIDER_DC_REQUEST,
      inputRevision: `preview-divider-dc-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} DC smoke failed.`,
    );
  }
  return validateDcDividerResult(payload, target);
}

export async function runPreviewSimulationSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify({
      ...DIVIDER_REQUEST,
      inputRevision: `preview-smoke-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[protocol:non-json] ${target} answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    const error = object(payload, "simulation refusal");
    const code = String(error.error ?? `http-${response.status}`);
    const layer = REQUEST_ERRORS.has(code) ? "request" : "infrastructure";
    throw new Error(
      `[${layer}:${code}] ${target} answered HTTP ${response.status}` +
        `${error.reason ? ` (${String(error.reason)})` : ""}` +
        `${error.message ? `: ${String(error.message)}` : ""}`,
    );
  }
  return validatePreviewSimulationResult(payload, target);
}
