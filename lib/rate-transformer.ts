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

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

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

function excelSerialToDate(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(Math.round((value - 25569) * 86_400_000));
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

export function formatEffectiveDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
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

export function transformRateRows(sourceRows: SourceRateRow[]): TransformationResult {
  const issues: ProcessingIssue[] = [];
  const decorated: Array<{ row: OutputRow; sourceIndex: number; combinationIndex: number; containerRank: number }> = [];
  let skippedRows = 0;

  sourceRows.forEach((source, sourceIndex) => {
    const sourceRow = sourceIndex + 2;
    const trade = TRADE_MAP[cellText(source.Trade).trim().toUpperCase()];
    if (!trade) {
      skippedRows += 1;
      issues.push({ sourceRow, reason: `Unsupported Trade value “${cellText(source.Trade) || "blank"}”.`, level: "error" });
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
