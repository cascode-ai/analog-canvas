/** Explicit output framing, not an input/analysis protocol or a numeric evaluator. */
export const VACASK_MEASUREMENT_PREFIX = "ICM_MEASUREMENT_V1 ";
export const VACASK_PLOT_PREFIX = "ICM_PLOT_V1 ";

/** Declare the meaning of an authored native ASCII raw record after writing it.
 * This helper does not evaluate expressions, write waveforms or read files. */
export function vacaskPlotPythonSource(): string {
  return `import json as _icm_plot_json

def report_plot(path, analysis, axis=None, probes=(), plot_ordinal=0):
    report = {"artifactPath": path, "plotOrdinal": plot_ordinal,
              "analysis": analysis, "probes": list(probes)}
    if axis is not None:
        report["axis"] = axis
    print(${JSON.stringify(VACASK_PLOT_PREFIX)} + _icm_plot_json.dumps(report, allow_nan=False), flush=True)
`;
}

/** Ordinary authored Python for a native postprocess program. No hidden runner,
 * imports outside the standard library, or frontend evaluation of expressions.
 * Call with a lambda so one failed measurement does not abort later reports. */
export function vacaskMeasurementPythonSource(): string {
  return `import json as _icm_json
import math as _icm_math
from numbers import Real as _icm_Real

def report_measurement(name, evaluate, unit=""):
    if not isinstance(name, str) or not name or len(name) > 128:
        raise ValueError("Measurement name must contain 1-128 characters")
    if not isinstance(unit, str) or len(unit) > 64:
        raise ValueError("Measurement unit must be a string of at most 64 characters")
    report = {"name": name, "unit": unit}
    try:
        value = evaluate() if callable(evaluate) else evaluate
        if not isinstance(value, _icm_Real) or isinstance(value, bool):
            raise ValueError("Measurement must be a real numeric scalar")
        value = float(value)
        if not _icm_math.isfinite(value):
            raise ValueError("Measurement is not finite")
        report.update(status="available", value=value)
    except Exception as error:
        report.update(status="unavailable", detail=str(error)[:1024])
    print(${JSON.stringify(VACASK_MEASUREMENT_PREFIX)} + _icm_json.dumps(report, allow_nan=False), flush=True)
`;
}
