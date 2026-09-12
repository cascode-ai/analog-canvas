import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NativeMeasurementResults } from "./native-measurement-results";

describe("native measurement evidence", () => {
  it("keeps repeated reports distinct and missing reports unavailable", () => {
    const html = renderToStaticMarkup(
      <NativeMeasurementResults
        measurements={[
          {
            name: "peak",
            status: "available",
            occurrence: 1,
            value: 0.5,
            logLine: 2,
            detail: "peak = 0.5",
          },
          {
            name: "peak",
            status: "available",
            occurrence: 2,
            value: 1,
            logLine: 4,
            detail: "peak = 1",
          },
          {
            name: "missing",
            status: "unavailable",
            occurrence: 0,
            detail: "Not reported",
          },
        ]}
      />,
    );
    expect(html.match(/<th>peak<\/th>/gu)).toHaveLength(2);
    expect(html).toContain("Console line 4");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Not reported");
  });
});
