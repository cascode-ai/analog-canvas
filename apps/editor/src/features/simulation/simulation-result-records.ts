import type { SimulationOutputData } from "@icm/simulation-service/contract";

type Analysis = SimulationOutputData["analyses"][number];
export type RecordSelection = Partial<Record<Analysis["analysis"], number>>;

/** Indices address this result only. Plot names and kinds are not record identity. */
export function resultRecordGroups(data: SimulationOutputData) {
  const groups = new Map<
    Analysis["analysis"],
    Array<{ index: number; analysis: Analysis }>
  >();
  data.analyses.forEach((analysis, index) => {
    const group = groups.get(analysis.analysis) ?? [];
    group.push({ index, analysis });
    groups.set(analysis.analysis, group);
  });
  return groups;
}

export function selectedResultRecords(
  data: SimulationOutputData,
  selection: RecordSelection = {},
) {
  return [...resultRecordGroups(data)].flatMap(([kind, records]) =>
    records.length === 1
      ? records
      : records.filter((record) => record.index === selection[kind]),
  );
}

export function resultRecordLabel(index: number, analysis: Analysis) {
  return `${analysis.plotName} · record ${analysis.rawPlotOrdinals?.join(", ") ?? index}`;
}
