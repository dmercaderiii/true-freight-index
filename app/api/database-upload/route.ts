import postgres from "postgres";
import { toDatabaseRecords } from "../../../lib/database-records";

const DATABASE_COLUMNS = [
  "agent", "carrier", "effective_date", "commodity", "origin", "origin_via",
  "destination", "destination_via", "container_size", "trade", "cea_nae", "cea_naw",
] as const;
const INSERT_BATCH_SIZE = 500;

export async function POST(request: Request) {
  if (!request.headers.get("oai-authenticated-user-id")) {
    return Response.json({ message: "You must be signed in to upload rates." }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Response.json({ message: "The database connection is not configured." }, { status: 503 });
  }

  try {
    const body = await request.json() as { rows?: unknown };
    const records = toDatabaseRecords(body.rows);
    const sql = postgres(databaseUrl, {
      ssl: "require",
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      prepare: false,
    });

    try {
      await sql.begin(async (transaction) => {
        for (let index = 0; index < records.length; index += INSERT_BATCH_SIZE) {
          const batch = records.slice(index, index + INSERT_BATCH_SIZE);
          await transaction`
            insert into public.tfx_test_environment
            ${transaction(batch, ...DATABASE_COLUMNS)}
          `;
        }
      });
    } finally {
      await sql.end({ timeout: 3 });
    }

    return Response.json({ inserted: records.length });
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
