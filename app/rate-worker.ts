/// <reference lib="webworker" />

import * as XLSX from "xlsx";
import { rowsFromMatrix, transformRateRows, validateHeaders } from "../lib/rate-transformer";

type WorkerRequest = { buffer: ArrayBuffer };

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    // cellDates is deliberately off: a parsed Date is an instant that has to be read back in
    // some timezone, which can shift Eff Date by a day. Raw serials convert arithmetically.
    const workbook = XLSX.read(data.buffer, { type: "array", dense: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("The workbook does not contain a readable worksheet.");
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1, defval: null, raw: true, blankrows: false,
    });
    if (!matrix.length) throw new Error("The first worksheet is empty.");
    const missing = validateHeaders(matrix[0]);
    if (missing.length) throw new Error(`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    self.postMessage({ type: "success", result: transformRateRows(rowsFromMatrix(matrix)) });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "The workbook could not be read.",
    });
  }
};

export {};
