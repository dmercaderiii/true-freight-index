import { timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import {
  partitionNewRecords, recordKey, toDatabaseRecords, type RecordIdentity,
} from "../../../lib/database-records";

const DATABASE_COLUMNS = [
  "agent", "carrier", "effective_date", "commodity", "origin", "origin_via",
  "destination", "destination_via", "container_size", "trade", "cea_nae", "cea_naw",
] as const;
const INSERT_BATCH_SIZE = 500;

function passwordsMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const expectedPassword = process.env.DATABASE_UPLOAD_PASSWORD;
  if (!expectedPassword) {
    return Response.json({ message: "Database uploads are not configured." }, { status: 503 });
  }

  const providedPassword = request.headers.get("x-database-upload-password") ?? "";
  if (!passwordsMatch(providedPassword, expectedPassword)) {
    return Response.json({ message: "The database upload passcode is incorrect." }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Response.json({ message: "The database connection is not configured." }, { status: 503 });
  }

  try {
    const body = await request.json() as { rows?: unknown; mode?: unknown };
    // "check" reports what would happen without writing, so the client can confirm first.
    const checkOnly = body.mode === "check";
    const records = toDatabaseRecords(body.rows);
    const sql = postgres(databaseUrl, {
      ssl: "require",
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      prepare: false,
    });

    const effectiveDates = [...new Set(records.map((record) => record.effective_date))];
    const datedValues = effectiveDates.filter((date): date is string => date !== null);
    const hasUndatedRecord = effectiveDates.length !== datedValues.length;
    let inserted = 0;
    let duplicates = 0;
    let fresh = 0;

    try {
      await sql.begin(async (transaction) => {
        // Only the effective dates in this payload can collide, so the lookup stays bounded.
        // The ::date casts keep this correct whether the column is a date or holds ISO text,
        // and to_char returns the same YYYY-MM-DD strings the records carry.
        const stored = await transaction<RecordIdentity[]>`
          select agent, carrier, to_char(effective_date::date, 'YYYY-MM-DD') as effective_date,
            commodity, origin, origin_via, destination, destination_via, container_size, trade
          from public.tfx_test_environment
          where effective_date::date = any(${datedValues}::date[])
            or (${hasUndatedRecord} and effective_date is null)
        `;

        const partition = partitionNewRecords(records, stored.map((row) => recordKey(row)));
        duplicates = partition.duplicates;
        fresh = partition.fresh.length;
        if (checkOnly) return;

        for (let index = 0; index < partition.fresh.length; index += INSERT_BATCH_SIZE) {
          const batch = partition.fresh.slice(index, index + INSERT_BATCH_SIZE);
          await transaction`
            insert into public.tfx_test_environment
            ${transaction(batch, ...DATABASE_COLUMNS)}
          `;
        }
        inserted = partition.fresh.length;
      });
    } finally {
      await sql.end({ timeout: 3 });
    }

    const total = records.length;
    return Response.json(checkOnly ? { total, duplicates, fresh } : { total, duplicates, inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database upload failed.";
    console.error("Rate database upload failed:", message);
    const isValidationError = /^(Row \d+|No processed records|A single database upload)/.test(message);
    return Response.json(
      { message: isValidationError ? message : "The database upload failed. No records were added." },
      { status: isValidationError ? 400 : 500 },
    );
  }
}
