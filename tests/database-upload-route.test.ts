import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/database-upload/route";

const originalUploadPassword = process.env.DATABASE_UPLOAD_PASSWORD;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalUploadPassword === undefined) delete process.env.DATABASE_UPLOAD_PASSWORD;
  else process.env.DATABASE_UPLOAD_PASSWORD = originalUploadPassword;

  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function uploadRequest(password = "") {
  return new Request("https://example.test/api/database-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-database-upload-password": password,
    },
    body: JSON.stringify({ rows: [] }),
  });
}

describe("database upload authorization", () => {
  it("keeps uploads disabled when no passcode is configured", async () => {
    delete process.env.DATABASE_UPLOAD_PASSWORD;
    const response = await POST(uploadRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ message: "Database uploads are not configured." });
  });

  it("rejects an incorrect passcode", async () => {
    process.env.DATABASE_UPLOAD_PASSWORD = "correct-passcode";
    const response = await POST(uploadRequest("incorrect-passcode"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: "The database upload passcode is incorrect." });
  });

  it("accepts the passcode before checking database configuration", async () => {
    process.env.DATABASE_UPLOAD_PASSWORD = "correct-passcode";
    delete process.env.DATABASE_URL;
    const response = await POST(uploadRequest("correct-passcode"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ message: "The database connection is not configured." });
  });
});
