import { describe, expect, it } from "vitest";
import { formatEffectiveDate, rowsToCsv, transformRateRows, type SourceRateRow } from "../lib/rate-transformer";

const base: SourceRateRow = {
  Agent: "Worldwide Logistics", Carrier: "HMM", "Eff Date": "8/1/2026", Commodity: "FAK",
  Origin: "Yantian", "Origin Via": "", Destination: "New York", "Destination Via": "",
  "20": 9467, "40": null, "40HC": null, Trade: "CEA-USEC",
};

describe("rate transformer", () => {
  it("transforms a normal row without slash-separated fields", () => {
    expect(transformRateRows([base]).rows).toEqual([
      ["Worldwide Logistics", "HMM", "8/1/2026", "FAK", "Yantian", "", "New York", "", "20FT", "USEC", "9467", ""],
    ]);
  });

  it("splits Los Angeles/Long Beach into separate records", () => {
    expect(transformRateRows([{ ...base, Destination: "Los Angeles/Long Beach" }]).rows.map((row) => row[6]))
      .toEqual(["Los Angeles", "Long Beach"]);
  });

  it("places USEC rates only in the USEC column", () => {
    expect(transformRateRows([base]).rows[0].slice(9)).toEqual(["USEC", "9467", ""]);
  });

  it("places USWC rates only in the USWC column", () => {
    expect(transformRateRows([{ ...base, Trade: "CEA-USWC", "20": 5839 }]).rows[0].slice(9))
      .toEqual(["USWC", "", "5839"]);
  });

  it.each([["20", "20FT"], ["40", "40FT"], ["40HC", "40HC"]] as const)("maps %s to %s", (source, output) => {
    const row = { ...base, "20": null, "40": null, "40HC": null, [source]: 100 };
    expect(transformRateRows([row]).rows[0][8]).toBe(output);
  });

  it("does not create records for blank container rates", () => {
    expect(transformRateRows([{ ...base, "20": 10, "40": "", "40HC": null }]).rows).toHaveLength(1);
  });

  it("preserves blank Origin Via and Destination Via", () => {
    const row = transformRateRows([base]).rows[0];
    expect([row[5], row[7]]).toEqual(["", ""]);
  });

  it("creates the cartesian product for multiple split location fields", () => {
    const rows = transformRateRows([{ ...base, Origin: "Yantian/Ningbo", Destination: "Los Angeles/Long Beach" }]).rows;
    expect(rows.map((row) => `${row[4]} → ${row[6]}`)).toEqual([
      "Yantian → Los Angeles", "Yantian → Long Beach", "Ningbo → Los Angeles", "Ningbo → Long Beach",
    ]);
  });

  it("writes exactly 12 escaped CSV columns", () => {
    const row = transformRateRows([{ ...base, Agent: 'Agent, "North"' }]).rows[0];
    expect(rowsToCsv([row]).startsWith('"Agent, ""North"""')).toBe(true);
    expect(row).toHaveLength(12);
  });

  it("sorts by Trade and then 20FT, 40FT, 40HC while preserving source order", () => {
    const rows = transformRateRows([
      { ...base, Carrier: "USWC first", Trade: "CEA-USWC", "20": 1, "40": 2, "40HC": 3 },
      { ...base, Carrier: "USEC second", Trade: "CEA-USEC", "20": 4, "40": 5, "40HC": 6 },
    ]).rows;
    expect(rows.map((row) => `${row[9]}-${row[8]}-${row[1]}`)).toEqual([
      "USEC-20FT-USEC second", "USEC-40FT-USEC second", "USEC-40HC-USEC second",
      "USWC-20FT-USWC first", "USWC-40FT-USWC first", "USWC-40HC-USWC first",
    ]);
  });

  it("keeps zero and reports unsupported trades", () => {
    expect(transformRateRows([{ ...base, "20": 0 }]).rows[0][10]).toBe("0");
    const invalid = transformRateRows([{ ...base, Trade: "OTHER" }]);
    expect(invalid.skippedRows).toBe(1);
    expect(invalid.issues[0].reason).toMatch(/Unsupported Trade/);
  });

  it("formats workbook Date objects without a timezone shift", () => {
    expect(formatEffectiveDate(new Date(2026, 7, 1))).toBe("8/1/2026");
  });
});
