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
    const split = { ...base, Destination: "Los Angeles/Long Beach", Trade: "CEA-USWC" };
    expect(transformRateRows([split]).rows.map((row) => row[6])).toEqual(["Los Angeles", "Long Beach"]);
  });

  it("places USEC rates only in the USEC column", () => {
    expect(transformRateRows([base]).rows[0].slice(9)).toEqual(["USEC", "9467", ""]);
  });

  it("places USWC rates only in the USWC column", () => {
    const west = { ...base, Destination: "Los Angeles", Trade: "CEA-USWC", "20": 5839 };
    expect(transformRateRows([west]).rows[0].slice(9)).toEqual(["USWC", "", "5839"]);
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
    const rows = transformRateRows([{
      ...base, Origin: "Yantian/Ningbo", Destination: "Los Angeles/Long Beach", Trade: "CEA-USWC",
    }]).rows;
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
      { ...base, Carrier: "USWC first", Destination: "Los Angeles", Trade: "CEA-USWC", "20": 1, "40": 2, "40HC": 3 },
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

describe("effective date reading", () => {
  // The worker reads raw Excel serials, so these are the values Eff Date actually arrives as.
  it.each([
    [46266, "9/1/2026"],
    [46265, "8/31/2026"],
    [45658, "1/1/2025"],
    [44197, "1/1/2021"],
    [25569, "1/1/1970"],
  ])("reads serial %i as %s", (serial, expected) => {
    expect(formatEffectiveDate(serial)).toBe(expected);
  });

  it("takes the day the workbook shows when a serial carries a time component", () => {
    // 46266.5 is midday on 9/1/2026; the time must not roll the day forward or back.
    expect(formatEffectiveDate(46266.5)).toBe("9/1/2026");
    expect(formatEffectiveDate(46266.999)).toBe("9/1/2026");
    expect(formatEffectiveDate(46266.001)).toBe("9/1/2026");
  });

  it("does not depend on the machine's timezone", () => {
    // Pure arithmetic: the same serial must format identically whatever the host offset is.
    const offsets = [-720, -480, 0, 330, 480, 780];
    const original = Date.prototype.getTimezoneOffset;
    try {
      for (const offset of offsets) {
        Date.prototype.getTimezoneOffset = () => offset;
        expect(formatEffectiveDate(46266)).toBe("9/1/2026");
      }
    } finally {
      Date.prototype.getTimezoneOffset = original;
    }
  });

  it("recovers the intended day from a Date at either midnight basis", () => {
    // Local midnight, as SheetJS builds them.
    expect(formatEffectiveDate(new Date(2026, 8, 1))).toBe("9/1/2026");
    // UTC midnight, which naive local reads would truncate to the previous day west of UTC.
    expect(formatEffectiveDate(new Date(Date.UTC(2026, 8, 1)))).toBe("9/1/2026");
  });

  it("still reads dates written as text", () => {
    expect(formatEffectiveDate("9/1/2026")).toBe("9/1/2026");
    expect(formatEffectiveDate("9-1-2026")).toBe("9/1/2026");
    expect(formatEffectiveDate("09/01/26")).toBe("9/1/2026");
  });

  it("rejects a serial that is not a real date", () => {
    expect(formatEffectiveDate(0)).toBe("0");
    expect(formatEffectiveDate(-5)).toBe("-5");
  });
});

describe("source row validation", () => {
  function reject(overrides: Partial<SourceRateRow>) {
    const result = transformRateRows([{ ...base, ...overrides }]);
    expect(result.rows).toHaveLength(0);
    expect(result.skippedRows).toBe(1);
    return result.issues.map((issue) => issue.reason).join(" ");
  }

  it("rejects a Trade that is neither CEA-USEC nor CEA-USWC", () => {
    expect(reject({ Trade: "CEA-EUR" })).toMatch(/Unsupported Trade value “CEA-EUR”/);
  });

  it.each(["1/2/2026", "8/7/2026", "8/16/2026", "8/31/2026"])("rejects the Eff Date %s", (effDate) => {
    expect(reject({ "Eff Date": effDate })).toMatch(/must fall on day 1, 8, 15, 22/);
  });

  it.each(["1/1/2026", "2/8/2026", "3/15/2026", "4/22/2026"])("accepts the Eff Date %s", (effDate) => {
    const result = transformRateRows([{ ...base, "Eff Date": effDate }]);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects an Eff Date that is not a real M/D/YYYY date", () => {
    expect(reject({ "Eff Date": "August 1st" })).toMatch(/is not a valid M\/D\/YYYY date/);
  });

  it("rejects an origin outside the approved port list", () => {
    expect(reject({ Origin: "Manila" })).toMatch(/Origin “Manila” is not an approved origin port/);
  });

  it("rejects an unapproved origin inside a slash-separated value", () => {
    expect(reject({ Origin: "Yantian/Manila" })).toMatch(/Origin “Manila” is not an approved/);
  });

  it.each(["Ningbo", "Yantian", "Shanghai", "Kaohsiung", "Vung Tau", "Singapore", "Hong Kong",
    "Pusan", "Kobe", "Busan"])("accepts the approved origin %s", (origin) => {
    expect(transformRateRows([{ ...base, Origin: origin }]).issues).toEqual([]);
  });

  it("rejects a destination outside the approved port list", () => {
    expect(reject({ Destination: "Miami" }))
      .toMatch(/Destination “Miami” is not an approved destination port/);
  });

  it.each(["Los Angeles", "Los Angeles/Long Beach", "Vancouver", "Oakland", "Long Beach",
    "Seattle", "Tacoma"])("requires CEA-USWC for the destination %s", (destination) => {
    expect(transformRateRows([{ ...base, Destination: destination, Trade: "CEA-USWC" }]).issues).toEqual([]);
    expect(reject({ Destination: destination, Trade: "CEA-USEC" }))
      .toMatch(/must use Trade CEA-USWC, not CEA-USEC/);
  });

  it.each(["New York", "Norfolk", "Charleston", "Savannah", "Houston", "Baltimore",
    "Newark"])("requires CEA-USEC for the destination %s", (destination) => {
    expect(transformRateRows([{ ...base, Destination: destination, Trade: "CEA-USEC" }]).issues).toEqual([]);
    expect(reject({ Destination: destination, Trade: "CEA-USWC" }))
      .toMatch(/must use Trade CEA-USEC, not CEA-USWC/);
  });

  it.each([
    ["Origin", "Origin is blank."],
    ["Destination", "Destination is blank."],
    ["Trade", "Trade is blank."],
  ] as const)("rejects a blank %s", (column, reason) => {
    expect(reject({ [column]: "" })).toContain(reason);
    expect(reject({ [column]: null })).toContain(reason);
  });

  it("reports every problem on a row before skipping it", () => {
    const reasons = reject({ Origin: "Manila", Destination: "Miami", Trade: "" });
    expect(reasons).toMatch(/Trade is blank/);
    expect(reasons).toMatch(/Origin “Manila”/);
    expect(reasons).toMatch(/Destination “Miami”/);
  });

  it("matches port names case-insensitively", () => {
    const result = transformRateRows([{ ...base, Origin: "  yantian ", Destination: "new york" }]);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it("keeps valid rows when another row is rejected", () => {
    const result = transformRateRows([{ ...base, Origin: "Manila" }, base]);
    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toBe(1);
    expect(result.sourceRows).toBe(2);
    expect(result.issues[0].sourceRow).toBe(2);
  });
});
