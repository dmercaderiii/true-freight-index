export const SOURCE_COLUMNS = [
  "Agent", "Carrier", "Eff Date", "Commodity", "Origin", "Origin Via",
  "Destination", "Destination Via", "20", "40", "40HC", "Trade",
] as const;

export const OUTPUT_COLUMNS = [
  "Agent", "Carrier", "Eff Date", "Commodity", "Origin", "Origin Via",
  "Destination", "Destination Via", "Container Size", "Trade", "USEC Rate", "USWC Rate",
] as const;

export type OutputRow = [string, string, string, string, string, string, string, string,
  "20FT" | "40FT" | "40HC", "USEC" | "USWC", string, string];

export type SourceRateRow = {
  Agent?: unknown; Carrier?: unknown; "Eff Date"?: unknown; Commodity?: unknown;
  Origin?: unknown; "Origin Via"?: unknown; Destination?: unknown; "Destination Via"?: unknown;
  "20"?: unknown; "40"?: unknown; "40HC"?: unknown; Trade?: unknown;
};

export type ProcessingIssue = { sourceRow: number; reason: string; level: "warning" | "error" };
export type TransformationResult = {
  rows: OutputRow[]; csv: string; sourceRows: number; skippedRows: number; issues: ProcessingIssue[];
};

const CONTAINERS = [
  { source: "20", output: "20FT" },
  { source: "40", output: "40FT" },
  { source: "40HC", output: "40HC" },
] as const;

const TRADE_MAP: Record<string, "USEC" | "USWC"> = { "CEA-USEC": "USEC", "CEA-USWC": "USWC" };

/** Effective dates follow a weekly cadence and must land on one of these days of the month. */
export const APPROVED_EFF_DATE_DAYS = [1, 8, 15, 22] as const;

export const APPROVED_ORIGINS = ["Ningbo", "Yantian", "Shanghai", "Kaohsiung", "Vung Tau",
  "Singapore", "Hong Kong", "Pusan", "Kobe", "Busan"] as const;

/**
 * Approved destinations and the Trade each one must use. Combined values such as
 * "Los Angeles/Long Beach" are split before validation, so only single ports are listed.
 */
export const APPROVED_DESTINATIONS: Record<string, "USEC" | "USWC"> = {
  "Los Angeles": "USWC", "Long Beach": "USWC", "Vancouver": "USWC",
  Oakland: "USWC", Seattle: "USWC", Tacoma: "USWC",
  "New York": "USEC", Newark: "USEC", Norfolk: "USEC", Charleston: "USEC",
  Savannah: "USEC", Houston: "USEC", Baltimore: "USEC",
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeLocation(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const EFF_DATE_DAYS = new Set<number>(APPROVED_EFF_DATE_DAYS);
const ORIGIN_LOOKUP = new Set(APPROVED_ORIGINS.map(normalizeLocation));
const DESTINATION_LOOKUP = new Map(Object.entries(APPROVED_DESTINATIONS)
  .map(([name, coast]) => [normalizeLocation(name), coast] as const));

function splitLocation(value: unknown): string[] {
  const valueText = cellText(value);
  if (!valueText.includes("/")) return [valueText];
  const parts = valueText.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [""];
}

function cartesianLocations(row: SourceRateRow): string[][] {
  const fields = [splitLocation(row.Origin), splitLocation(row["Origin Via"]),
    splitLocation(row.Destination), splitLocation(row["Destination Via"])];
  return fields.reduce<string[][]>(
    (combinations, values) => combinations.flatMap((combination) =>
      values.map((value) => [...combination, value])),
    [[]],
  );
}

function normalizeRate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const compact = String(value).trim().replace(/,/g, "");
  if (!compact || !/^-?\d+(?:\.\d+)?$/.test(compact)) return null;
  const numeric = Number(compact);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

/**
 * Converts an Excel serial to the calendar date the workbook displays. The integer part is
 * that date, so any time component is dropped rather than allowed to shift the day, and the
 * arithmetic runs entirely in UTC — the result never depends on the reader's timezone.
 */
function excelSerialToDate(value: number): string | null {
  if (!Number.isFinite(value) || value < 1) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

export function formatEffectiveDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // The worker reads serials rather than Dates, so this only catches a Date from elsewhere.
    // Such a value encodes a calendar day as midnight in one basis or the other: read it in
    // whichever basis lands on midnight, so the day is never truncated into its neighbour.
    const isUtcMidnight = value.getUTCHours() === 0
      && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
    return isUtcMidnight
      ? `${value.getUTCMonth() + 1}/${value.getUTCDate()}/${value.getUTCFullYear()}`
      : `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  }
  if (typeof value === "number") return excelSerialToDate(value) ?? String(value);
  const valueText = String(value).trim();
  const match = valueText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return valueText;
  const shortYear = Number(match[3]);
  const year = match[3].length === 2 ? (shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear) : shortYear;
  return `${Number(match[1])}/${Number(match[2])}/${year}`;
}

export function escapeCsvField(value: unknown): string {
  const valueText = cellText(value);
  return /[",\r\n]/.test(valueText) ? `"${valueText.replace(/"/g, '""')}"` : valueText;
}

export function rowsToCsv(rows: OutputRow[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

export function validateHeaders(headers: unknown[]): string[] {
  const normalized = new Set(headers.map((header) => cellText(header).trim().toLowerCase()));
  return SOURCE_COLUMNS.filter((column) => !normalized.has(column.toLowerCase()));
}

export function rowsFromMatrix(matrix: unknown[][]): SourceRateRow[] {
  if (!matrix.length) return [];
  const headerIndexes = new Map<string, number>();
  matrix[0].forEach((header, index) => headerIndexes.set(cellText(header).trim().toLowerCase(), index));
  return matrix.slice(1).map((values) => {
    const row: SourceRateRow = {};
    for (const column of SOURCE_COLUMNS) row[column] = values[headerIndexes.get(column.toLowerCase()) ?? -1] ?? null;
    return row;
  });
}

type SourceValidation = { issues: ProcessingIssue[]; trade: "USEC" | "USWC" | null };

/**
 * Checks a source row against the approved trades, effective-date cadence, and port lists.
 * Any reported issue rejects the whole row so partial data never reaches the output.
 */
function validateSourceRow(source: SourceRateRow, sourceRow: number): SourceValidation {
  const issues: ProcessingIssue[] = [];
  const reject = (reason: string) => issues.push({ sourceRow, reason, level: "error" });

  const originText = cellText(source.Origin).trim();
  const destinationText = cellText(source.Destination).trim();
  const tradeText = cellText(source.Trade).trim();

  if (!originText) reject("Origin is blank.");
  if (!destinationText) reject("Destination is blank.");
  if (!tradeText) reject("Trade is blank.");

  const trade = TRADE_MAP[tradeText.toUpperCase()] ?? null;
  if (tradeText && !trade) {
    reject(`Unsupported Trade value “${tradeText}”. Use CEA-USEC or CEA-USWC.`);
  }

  const effDate = formatEffectiveDate(source["Eff Date"]);
  const effDateParts = effDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!effDate) {
    reject("Eff Date is blank.");
  } else if (!effDateParts) {
    reject(`Eff Date “${effDate}” is not a valid M/D/YYYY date.`);
  } else if (!EFF_DATE_DAYS.has(Number(effDateParts[2]))) {
    reject(`Eff Date “${effDate}” must fall on day ${APPROVED_EFF_DATE_DAYS.join(", ")} of the month.`);
  }

  if (originText) {
    for (const origin of splitLocation(originText)) {
      if (!ORIGIN_LOOKUP.has(normalizeLocation(origin))) {
        reject(`Origin “${origin}” is not an approved origin port.`);
      }
    }
  }

  if (destinationText) {
    for (const destination of splitLocation(destinationText)) {
      const requiredCoast = DESTINATION_LOOKUP.get(normalizeLocation(destination));
      if (!requiredCoast) {
        reject(`Destination “${destination}” is not an approved destination port.`);
      } else if (trade && requiredCoast !== trade) {
        reject(`Destination “${destination}” must use Trade CEA-${requiredCoast}, not ${tradeText}.`);
      }
    }
  }

  return { issues, trade };
}

export function transformRateRows(sourceRows: SourceRateRow[]): TransformationResult {
  const issues: ProcessingIssue[] = [];
  const decorated: Array<{ row: OutputRow; sourceIndex: number; combinationIndex: number; containerRank: number }> = [];
  let skippedRows = 0;

  sourceRows.forEach((source, sourceIndex) => {
    const sourceRow = sourceIndex + 2;
    const validation = validateSourceRow(source, sourceRow);
    const trade = validation.trade;
    if (validation.issues.length || !trade) {
      skippedRows += 1;
      issues.push(...validation.issues);
      return;
    }

    const validContainers = CONTAINERS.flatMap((container, containerRank) => {
      const rawRate = source[container.source];
      const rate = normalizeRate(rawRate);
      if (rate === null) {
        if (rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "") {
          issues.push({ sourceRow, reason: `${container.source} rate “${cellText(rawRate)}” is not numeric and was omitted.`, level: "warning" });
        }
        return [];
      }
      return [{ ...container, rate, containerRank }];
    });

    if (!validContainers.length) {
      skippedRows += 1;
      issues.push({ sourceRow, reason: "No valid container rates were found.", level: "warning" });
      return;
    }

    const locations = cartesianLocations(source);
    validContainers.forEach((container) => locations.forEach(
      ([origin, originVia, destination, destinationVia], combinationIndex) => {
        const row: OutputRow = [cellText(source.Agent), cellText(source.Carrier),
          formatEffectiveDate(source["Eff Date"]), cellText(source.Commodity), origin, originVia,
          destination, destinationVia, container.output, trade,
          trade === "USEC" ? container.rate : "", trade === "USWC" ? container.rate : ""];
        decorated.push({ row, sourceIndex, combinationIndex, containerRank: container.containerRank });
      },
    ));
  });

  decorated.sort((a, b) => {
    const tradeDifference = (a.row[9] === "USEC" ? 0 : 1) - (b.row[9] === "USEC" ? 0 : 1);
    return tradeDifference || a.containerRank - b.containerRank ||
      a.sourceIndex - b.sourceIndex || a.combinationIndex - b.combinationIndex;
  });
  const rows = decorated.map(({ row }) => row);
  return { rows, csv: rowsToCsv(rows), sourceRows: sourceRows.length, skippedRows, issues };
}
