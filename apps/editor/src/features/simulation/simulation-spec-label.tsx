import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { SimulationSpecResult } from "@icm/simulation-service/contract";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  CANONICAL_FORMULA_FONT_SIZE,
  cachedFormulaResult,
  prepareFormula,
  type FormulaTypesetResult,
} from "@icm/math-typesetting/cache";
type Label = NonNullable<SimulationSpecResult["label"]>;
type LabelRun = Label["runs"][number];

function FormulaLabel({ latex, display }: Extract<LabelRun, { kind: "math" }>) {
  const [prepared, setPrepared] = useState<{
    latex: string;
    display: string;
    result: FormulaTypesetResult;
  }>();
  const request = { latex, display, profileId: ANALOG_CANVAS_MATH_PROFILE_ID };
  const result =
    prepared?.latex === latex && prepared.display === display
      ? prepared.result
      : cachedFormulaResult(request);
  useEffect(() => {
    let active = true;
    void prepareFormula({
      latex,
      display,
      profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
    }).then(
      (result) => {
        if (active) setPrepared({ latex, display, result });
      },
      () => {
        /* Keep the readable source if the optional typesetter fails to load. */
      },
    );
    return () => {
      active = false;
    };
  }, [latex, display]);
  if (!result?.ok) return <span>{latex}</span>;
  const artifact = result.artifact;
  return (
    <img
      alt={latex}
      src={`data:image/svg+xml,${encodeURIComponent(artifact.svg)}`}
      style={{
        width: `${artifact.width / CANONICAL_FORMULA_FONT_SIZE}em`,
        height: `${artifact.height / CANONICAL_FORMULA_FONT_SIZE}em`,
        verticalAlign: `${(artifact.baseline - artifact.height) / CANONICAL_FORMULA_FONT_SIZE}em`,
      }}
    />
  );
}

function renderRun(run: LabelRun): ReactNode {
  switch (run.kind) {
    case "text":
      return run.value;
    case "math":
      return <FormulaLabel {...run} />;
    case "span": {
      const children = runs(run.children);
      switch (run.style) {
        case "bold":
          return <strong>{children}</strong>;
        case "italic":
          return <em>{children}</em>;
        case "subscript":
          return <sub>{children}</sub>;
        case "superscript":
          return <sup>{children}</sup>;
        case "overbar":
          return <span style={{ textDecoration: "overline" }}>{children}</span>;
      }
    }
  }
}
function runs(items: LabelRun[]) {
  return items.map((run, index) => (
    <Fragment key={index}>{renderRun(run)}</Fragment>
  ));
}
export function SimulationSpecLabel({ document }: { document: Label }) {
  return <>{runs(document.runs)}</>;
}
