import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeviceOperatingPointResults } from "./device-operating-point-results";

describe("DeviceOperatingPointResults", () => {
  it("distinguishes repeated raw records of the same MOS occurrence", () => {
    const markup = renderToStaticMarkup(
      <DeviceOperatingPointResults
        devices={[0, 1].map((analysisIndex) => ({
          id: "mos",
          documentId: "dut",
          instanceId: "M1",
          occurrence: [],
          reference: "M1",
          polarity: "nmos",
          analysisIndex,
          rawPlotOrdinals: [analysisIndex + 3],
          values: [
            {
              parameter: "vgs",
              label: "VGS",
              unit: "V",
              status: "available",
              value: analysisIndex + 1,
            },
          ],
        }))}
      />,
    );
    expect(markup).toContain("Record 3");
    expect(markup).toContain("Record 4");
    expect(markup).toContain("1.00000 V");
    expect(markup).toContain("2.00000 V");
  });
  it("groups available and unavailable values by authored MOS occurrence", () => {
    const markup = renderToStaticMarkup(
      <DeviceOperatingPointResults
        devices={[
          {
            id: "op-m1",
            documentId: "dut",
            instanceId: "M1",
            occurrence: ["XDUT"],
            reference: "XM1",
            polarity: "nmos",
            values: [
              {
                parameter: "vgs",
                label: "VGS",
                unit: "V",
                status: "available",
                value: 0.9,
              },
              {
                parameter: "id",
                label: "ID",
                unit: "A",
                status: "unavailable",
                reason: "missing acquisition",
              },
            ],
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="XM1 details"');
    expect(markup).toContain("NMOS");
    expect(markup).toContain("VGS");
    expect(markup).toContain("0.900000 V");
    expect(markup).toContain("ID");
  });
});
