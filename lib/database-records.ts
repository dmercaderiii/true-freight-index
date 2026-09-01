export type DatabaseRateRecord = {
  agent: string | null;
  carrier: string | null;
  effective_date: string | null;
  commodity: string | null;
  origin: string | null;
  origin_via: string | null;
  destination: string | null;
  destination_via: string | null;
  container_size: string | null;
  trade: string | null;
  cea_nae: number | null;
  cea_naw: number | null;
};

const MAX_DATABASE_ROWS = 50_000;

/**
 * Columns that identify a rate quote. Two records matching on all of them are the same
 * quote, so only the rate amounts (cea_nae / cea_naw) are excluded.
 */
export const IDENTITY_COLUMNS = ["agent", "carrier", "effective_date", "commodity", "origin",
  "origin_via", "destination", "destination_via", "container_size", "trade"] as const;

export type RecordIdentity = Pick<DatabaseRateRecord, (typeof IDENTITY_COLUMNS)[number]>;

/** Joins the identity columns with a null byte, which cannot occur in the column values. */
export function recordKey(record: RecordIdentity): string {
  return IDENTITY_COLUMNS.map((column) => record[column] ?? "").join("\u0000");
}

/**
 * Splits records into those not yet in the database and a count of those already there.
 *
 * The comparison is strictly payload against stored rows. Rows the workbook lists more than
 * once are all kept: a repeated identity routinely carries a different rate — the same lane
 * quoted twice at two prices — so collapsing them would silently drop real quotes.
 */
export function partitionNewRecords(
  records: DatabaseRateRecord[],
  existingKeys: Iterable<string>,
): { fresh: DatabaseRateRecord[]; stored: number } {
  const storedKeys = new Set(existingKeys);
  const fresh: DatabaseRateRecord[] = [];
  let stored = 0;

  for (const record of records) {
    if (storedKeys.has(recordKey(record))) {
      stored += 1;
      continue;
    }
    fresh.push(record);
  }

  return { fresh, stored };
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function nullableNumber(value: unknown, field: string, rowNumber: number): number | null {
  const text = nullableText(value);
  if (text === null) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) throw new Error(`Row ${rowNumber}: ${field} must be numeric or blank.`);
  return numeric;
}

function databaseDate(value: unknown, rowNumber: number): string | null {
  const text = nullableText(value);
  if (text === null) return null;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`Row ${rowNumber}: effective date must use M/D/YYYY.`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Row ${rowNumber}: effective date is invalid.`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function toDatabaseRecord(value: unknown, index = 0): DatabaseRateRecord {
  const rowNumber = index + 1;
  if (!Array.isArray(value) || value.length !== 12) {
    throw new Error(`Row ${rowNumber}: expected exactly 12 output columns.`);
  }
  const containerSize = nullableText(value[8]);
  const trade = nullableText(value[9]);
  if (containerSize !== null && !["20FT", "40FT", "40HC"].includes(containerSize)) {
    throw new Error(`Row ${rowNumber}: unsupported container size.`);
  }
  if (trade !== null && !["USEC", "USWC"].includes(trade)) {
    throw new Error(`Row ${rowNumber}: unsupported trade value.`);
  }

  return {
    agent: nullableText(value[0]),
    carrier: nullableText(value[1]),
    effective_date: databaseDate(value[2], rowNumber),
    commodity: nullableText(value[3]),
    origin: nullableText(value[4]),
    origin_via: nullableText(value[5]),
    destination: nullableText(value[6]),
    destination_via: nullableText(value[7]),
    container_size: containerSize,
    trade,
    cea_nae: nullableNumber(value[10], "cea_nae", rowNumber),
    cea_naw: nullableNumber(value[11], "cea_naw", rowNumber),
  };
}

export function toDatabaseRecords(value: unknown): DatabaseRateRecord[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("No processed records were supplied.");
  if (value.length > MAX_DATABASE_ROWS) {
    throw new Error(`A single database upload is limited to ${MAX_DATABASE_ROWS.toLocaleString()} records.`);
  }
  return value.map(toDatabaseRecord);
}
