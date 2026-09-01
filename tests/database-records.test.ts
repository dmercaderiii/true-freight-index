import { describe, expect, it } from "vitest";
import {
  partitionNewRecords, recordKey, toDatabaseRecord, toDatabaseRecords,
} from "../lib/database-records";

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

describe("duplicate upload detection", () => {
  const row = (over: Partial<Record<number, string>> = {}) => toDatabaseRecord([
    "OST", "EMC", "1/1/2026", "FAK", "Pusan", "", "Baltimore", "", "20FT", "USEC", "1905", "",
  ].map((value, index) => over[index] ?? value));

  it("ignores the rate amounts when identifying a record", () => {
    expect(recordKey(row({ 10: "2500" }))).toBe(recordKey(row()));
  });

  it.each([[0, "Agent"], [1, "Carrier"], [2, "1/8/2026"], [3, "Commodity"], [4, "Ningbo"],
    [5, "Origin Via"], [6, "Savannah"], [7, "Destination Via"], [8, "40HC"]] as const)(
    "treats a different value in column %i as a different record", (index, value) => {
      expect(recordKey(row({ [index]: value }))).not.toBe(recordKey(row()));
    });

  it("does not confuse a blank column with a neighbouring value", () => {
    // "Los Angeles" + blank via must not collide with "Los" + "Angeles".
    const joined = recordKey(row({ 6: "Los Angeles", 7: "" }));
    const split = recordKey(row({ 6: "Los", 7: "Angeles" }));
    expect(joined).not.toBe(split);
  });

  it("keeps every record when the table is empty", () => {
    const records = [row(), row({ 8: "40FT" })];
    expect(partitionNewRecords(records, [])).toEqual({ fresh: records, stored: 0 });
  });

  it("skips records already stored and inserts the rest", () => {
    const stored = row();
    const fresh = row({ 8: "40FT" });
    const partition = partitionNewRecords([stored, fresh], [recordKey(stored)]);
    expect(partition.fresh).toEqual([fresh]);
    expect(partition.stored).toBe(1);
  });

  it("skips the whole payload when the same upload is repeated", () => {
    const records = [row(), row({ 8: "40FT" }), row({ 8: "40HC" })];
    const partition = partitionNewRecords(records, records.map(recordKey));
    expect(partition.fresh).toEqual([]);
    expect(partition.stored).toBe(3);
  });

  it("keeps rows the workbook lists twice, because their rates can differ", () => {
    // The same lane quoted at two prices must not collapse into one record.
    const cheaper = row({ 10: "10411" });
    const dearer = row({ 10: "10501" });
    expect(recordKey(cheaper)).toBe(recordKey(dearer));

    const partition = partitionNewRecords([cheaper, dearer], []);
    expect(partition.fresh).toEqual([cheaper, dearer]);
    expect(partition.stored).toBe(0);
  });

  it("compares only against the database, never the payload against itself", () => {
    const partition = partitionNewRecords([row(), row(), row({ 8: "40FT" })], []);
    expect(partition.fresh).toHaveLength(3);
    expect(partition.stored).toBe(0);
  });

  it("skips every copy of a row that is already stored", () => {
    const stored = row();
    const partition = partitionNewRecords([stored, stored, row({ 8: "40FT" })], [recordKey(stored)]);
    expect(partition.fresh).toHaveLength(1);
    expect(partition.stored).toBe(2);
  });

  it("does not mutate the caller's set of stored keys", () => {
    const stored = new Set([recordKey(row())]);
    partitionNewRecords([row({ 8: "40FT" })], stored);
    expect(stored.size).toBe(1);
  });
});
