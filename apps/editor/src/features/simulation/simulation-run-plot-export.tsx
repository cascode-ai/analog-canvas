import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Run } from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";
import { SimulationRunDetails } from "./simulation-run-details";
import { SimulationOutputResults } from "./simulation-output-results";
import { AcResultsExplorer } from "./ac-results-explorer";
import { DcResultsExplorer } from "./dc-results-explorer";
import { TransientResultsExplorer } from "./transient-results-explorer";
import {
  buildVisibleSimulationPlotDownload,
  type SimulationPlotExportFormat,
} from "./simulation-plot-export";

/** File adapter over the existing Results renderer; no second plot or numeric implementation.
 * The isolated static render cannot change the user's selected run, zoom or focus. */
export async function buildSimulationRunPlotDownload(
  files: SimulationFiles,
  receipt: Run,
  analysisIndex: number,
  format: SimulationPlotExportFormat,
) {
  const detailed = await new SimulationRunDetails().read(files, receipt);
  if (!detailed.ok) throw Error(detailed.error.message);
  const run = detailed.run;
  let content: ReactNode;
  if (run.outputData) {
    const analysis = run.outputData.analyses[analysisIndex];
    if (!analysis || analysis.analysis === "op")
      throw Error(
        "Select an existing waveform analysis record; OP is a scalar table",
      );
    content = (
      <SimulationOutputResults
        resultKey={`export:${run.id}:${analysisIndex}`}
        data={{ ...run.outputData, analyses: [analysis] }}
        outputs={[]}
      />
    );
  } else {
    const analysis = run.result?.data?.analyses[analysisIndex];
    if (!analysis) throw Error("The selected analysis record is not available");
    if (analysis.analysis === "ac")
      content = (
        <AcResultsExplorer analysis={analysis} vectors={[]} probes={[]} />
      );
    else if (analysis.analysis === "dc")
      content = (
        <DcResultsExplorer analysis={analysis} vectors={[]} probes={[]} />
      );
    else if (analysis.analysis === "tran")
      content = (
        <TransientResultsExplorer
          analysis={analysis}
          vectors={[]}
          probes={[]}
        />
      );
    else
      throw Error(
        "This record has no waveform plot; export its numeric data instead",
      );
  }
  const root = document.createElement("div");
  root.className = "spice-simulation-surface simulation-file-export";
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "900px",
    pointerEvents: "none",
  });
  root.innerHTML = renderToStaticMarkup(content, {
    identifierPrefix: `export-${crypto.randomUUID()}-`,
  });
  document.body.append(root);
  try {
    const result = await buildVisibleSimulationPlotDownload(root, format);
    if (!result)
      throw Error("No plotted vectors were collected for this analysis record");
    return result;
  } finally {
    root.remove();
  }
}
