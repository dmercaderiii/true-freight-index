import { describe, expect, it } from "vitest";
import { toDatabaseRecord, toDatabaseRecords } from "../lib/database-records";

describe("database record mapping", () => {
  it("maps USEC output to cea_nae and converts blanks to null", () => {
    expect(toDatabaseRecord([
      "OST", "EMC", "1/1/2023", "FAK", "Pusan", "", "Baltimore", "",
      "20FT", "USEC", "1905", "",
    ])).toEqual({
      agent: "OST", carrier: "EMC", effective_date: "2023-01-01", commodity: "FAK",
      origin: "Pusan", origin_via: null, destination: "Baltimore", destination_via: null,
      container_size: "20FT", trade: "USEC", cea_nae: 1905, cea_naw: null,
    });
  });

  it("maps USWC output to cea_naw", () => {
    const record = toDatabaseRecord([
      "Worldwide Logistics", "HMM", "8/1/2026", "FAK", "Yantian", "",
      "Los Angeles", "", "40HC", "USWC", "", "7296",
    ]);
    expect(record.cea_nae).toBeNull();
    expect(record.cea_naw).toBe(7296);
  });

  it("rejects malformed rows and invalid dates", () => {
    expect(() => toDatabaseRecords([])).toThrow(/No processed records/);
    expect(() => toDatabaseRecord(["too", "short"])).toThrow(/exactly 12/);
    expect(() => toDatabaseRecord([
      "A", "B", "2/30/2026", "FAK", "O", "", "D", "", "20FT", "USEC", "1", "",
    ])).toThrow(/date is invalid/);
  });
});
