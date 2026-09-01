"use client";

import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Database, Download, FileSpreadsheet,
  LoaderCircle, RefreshCcw, UploadCloud, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { OUTPUT_COLUMNS, type TransformationResult } from "../lib/rate-transformer";

type Status = "idle" | "processing" | "success" | "error";
type DatabaseStatus = "idle" | "checking" | "uploading" | "success" | "duplicate" | "error";
/** `stored` is already in the database; `repeated` is a row the workbook itself lists twice. */
type DuplicateCheck = { total: number; stored: number; repeated: number; fresh: number };
const PAGE_SIZE = 75;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Names what was left out, keeping stored rows and in-workbook repeats clearly distinct. */
function skippedSentence(stored: number, repeated: number) {
  const parts: string[] = [];
  if (stored) parts.push(`${stored.toLocaleString()} ${stored === 1 ? "was" : "were"} already in the database`);
  if (repeated) parts.push(`${repeated.toLocaleString()} ${repeated === 1 ? "was a repeat" : "were repeats"} of other rows in the workbook`);
  return parts.length ? `Skipped: ${parts.join(", and ")}.` : "";
}

function buildCsvFilename(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `CEA-NAE_NAW Rate Analysis Report ${month}${day}${date.getFullYear()}.csv`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TransformationResult | null>(null);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [page, setPage] = useState(1);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus>("idle");
  const [databaseMessage, setDatabaseMessage] = useState("");
  const [databasePassword, setDatabasePassword] = useState("");
  const [showDatabaseConfirm, setShowDatabaseConfirm] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheck | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // Reported issues mean the source workbook needs fixing, so exports stay blocked until it is clean.
  const canExport = Boolean(result && result.issues.length === 0 && result.rows.length > 0);
  const pageCount = result ? Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE)) : 1;
  const visibleRows = useMemo(
    () => result?.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [],
    [result, page],
  );

  function reset() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus("idle");
    setFile(null);
    setResult(null);
    setError("");
    setPage(1);
    setDatabaseStatus("idle");
    setDatabaseMessage("");
    setDatabasePassword("");
    setShowDatabaseConfirm(false);
    setDuplicateCheck(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function processFile(selected: File) {
    if (!selected.name.toLowerCase().endsWith(".xlsx")) {
      setStatus("error");
      setError("Please choose an Excel workbook with the .xlsx extension.");
      setFile(selected);
      return;
    }

    setFile(selected);
    setStatus("processing");
    setError("");
    setResult(null);
    setPage(1);

    try {
      const buffer = await selected.arrayBuffer();
      const worker = new Worker(new URL("./rate-worker.ts", import.meta.url), { type: "module" });
      workerRef.current?.terminate();
      workerRef.current = worker;
      worker.onmessage = ({ data }) => {
        if (data.type === "success") {
          setResult(data.result);
          setStatus("success");
        } else {
          setError(data.message || "The workbook could not be processed.");
          setStatus("error");
        }
        worker.terminate();
        workerRef.current = null;
      };
      worker.onerror = (event) => {
        const detail = event.message && event.message !== "Script error."
          ? ` Processor error: ${event.message}`
          : "";
        setError(`The Excel processor could not start.${detail} Please try the file again.`);
        setStatus("error");
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ buffer }, [buffer]);
    } catch {
      setError("The workbook could not be read. Check the file and try again.");
      setStatus("error");
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) void processFile(selected);
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const selected = event.dataTransfer.files?.[0];
    if (selected) void processFile(selected);
  }

  function downloadCsv() {
    if (!result || !canExport) return;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildCsvFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function closeDatabaseConfirm() {
    // Drop the pending check so reopening the dialog always re-checks against the database.
    setShowDatabaseConfirm(false);
    setDuplicateCheck(null);
    setDatabaseStatus("idle");
  }

  async function postRows(mode: "check" | "insert", rows: TransformationResult["rows"]) {
    const response = await fetch("/api/database-upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-database-upload-password": databasePassword,
      },
      body: JSON.stringify({ rows, mode }),
    });
    const payload = await response.json() as Partial<DuplicateCheck> & { inserted?: number; message?: string };
    if (!response.ok) throw new Error(payload.message || "The database upload failed.");
    return payload;
  }

  function failUpload(uploadError: unknown) {
    setShowDatabaseConfirm(false);
    setDuplicateCheck(null);
    setDatabaseStatus("error");
    setDatabaseMessage(uploadError instanceof Error ? uploadError.message : "The database upload failed.");
  }

  async function appendRecords() {
    if (!result) return;
    setShowDatabaseConfirm(false);
    setDatabaseStatus("uploading");
    try {
      const payload = await postRows("insert", result.rows);
      const inserted = payload.inserted ?? 0;
      setDatabasePassword("");
      setDuplicateCheck(null);
      setDatabaseStatus("success");
      setDatabaseMessage([
        `${inserted.toLocaleString()} record${inserted === 1 ? "" : "s"} were appended to the database.`,
        skippedSentence(payload.stored ?? 0, payload.repeated ?? 0),
      ].filter(Boolean).join(" "));
    } catch (uploadError) {
      failUpload(uploadError);
    }
  }

  /**
   * Compares the records against the database before writing. An entirely duplicate upload is
   * refused outright; a partly duplicate one waits for the user to confirm the new records.
   */
  async function checkThenAppend() {
    if (!result || !canExport) return;
    if (duplicateCheck) {
      await appendRecords();
      return;
    }

    setDatabaseStatus("checking");
    setDatabaseMessage("");
    try {
      const payload = await postRows("check", result.rows);
      const total = payload.total ?? result.rows.length;
      const stored = payload.stored ?? 0;
      const repeated = payload.repeated ?? 0;
      const fresh = payload.fresh ?? total;

      // Only rows already in the database make an upload a true duplicate; a workbook that
      // merely repeats its own rows still has something new to contribute.
      if (fresh === 0 && stored > 0) {
        setShowDatabaseConfirm(false);
        setDatabasePassword("");
        setDatabaseStatus("duplicate");
        setDatabaseMessage(`Duplicate upload. All ${total.toLocaleString()} records are already in the database, so nothing was uploaded.`);
        return;
      }
      if (stored > 0 || repeated > 0) {
        setDuplicateCheck({ total, stored, repeated, fresh });
        setDatabaseStatus("idle");
        return;
      }
      await appendRecords();
    } catch (uploadError) {
      failUpload(uploadError);
    }
  }

  return (
    <main id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TrueFreight Index home">
          {/* The source asset is already optimized and does not need a runtime image service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/tfx-logo-horizontal.png" alt="TrueFreight Index from FreightRight" />
        </a>
      </header>

      <section className="workspace" aria-live="polite">
        <div className="section-heading">
          <div><span className="step-number">01</span><h2>Upload Excel File</h2></div>
        </div>

        {status === "idle" && (
          <div className={`dropzone ${dragActive ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
            onDrop={dropFile}>
            <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} />
            <div className="upload-icon"><UploadCloud size={30} /></div>
            <h3>Drop your Excel file here</h3>
            <p>or select it from your computer</p>
            <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>Choose Excel File</button>
          </div>
        )}

        {status !== "idle" && file && (
          <div className={`file-status ${status}`}>
            <div className="file-icon"><FileSpreadsheet size={24} /></div>
            <div className="file-details"><strong>{file.name}</strong><span>{formatFileSize(file.size)}</span></div>
            <div className="status-label">
              {status === "processing" && <><LoaderCircle className="spin" size={18} /> Processing workbook</>}
              {status === "success" && <><Check size={18} /> Ready to download</>}
              {status === "error" && <><AlertCircle size={18} /> Needs attention</>}
            </div>
            {status !== "processing" && <button className="icon-button" type="button" onClick={reset} aria-label="Remove file"><X size={18} /></button>}
          </div>
        )}

        {status === "processing" && (
          <div className="processing-panel"><div className="progress-track"><span /></div><p>Reading rows, expanding locations, and normalizing container rates…</p></div>
        )}

        {status === "error" && (
          <div className="error-panel" role="alert"><AlertCircle size={20} />
            <div><strong>We couldn’t process this file</strong><p>{error}</p></div>
            <button type="button" onClick={reset}>Try another file</button>
          </div>
        )}
      </section>

      {status === "success" && result && (
        <section className="results-section">
          <div className="results-header">
            <div><span className="step-number">02</span><h2>Review Data</h2><p>Showing all 12 output fields. The downloaded CSV has no header row.</p></div>
            <div className="result-actions">
              <button className="secondary-button" type="button" onClick={reset}><RefreshCcw size={17} /> Upload another</button>
              <button
                className="download-button"
                type="button"
                disabled={!canExport}
                title={canExport ? undefined : "Resolve the reported issues before downloading."}
                onClick={downloadCsv}
              >
                <Download size={18} /> Download CSV
              </button>
              <button
                className="database-button"
                type="button"
                disabled={!canExport || databaseStatus === "checking" || databaseStatus === "uploading"
                  || databaseStatus === "success" || databaseStatus === "duplicate"}
                title={canExport
                  ? (databaseStatus === "duplicate" ? "Every record is already in the database." : undefined)
                  : "Resolve the reported issues before uploading."}
                onClick={() => { setDuplicateCheck(null); setShowDatabaseConfirm(true); }}
              >
                {databaseStatus === "checking" || databaseStatus === "uploading" ? <LoaderCircle className="spin" size={18} />
                  : databaseStatus === "success" ? <Check size={18} />
                  : databaseStatus === "duplicate" ? <AlertCircle size={18} /> : <Database size={18} />}
                {databaseStatus === "checking" ? "Checking…"
                  : databaseStatus === "uploading" ? "Uploading…"
                  : databaseStatus === "success" ? "Uploaded"
                  : databaseStatus === "duplicate" ? "Already in database" : "Upload to Database"}
              </button>
            </div>
          </div>

          {!canExport && (
            <div className="database-result error" role="alert">
              <AlertCircle size={19} />
              <span>
                {result.rows.length === 0
                  ? "No records passed validation. Correct the source workbook and upload it again."
                  : `Download and database upload are disabled until all ${result.issues.length.toLocaleString()} reported issue${result.issues.length === 1 ? "" : "s"} ${result.issues.length === 1 ? "is" : "are"} corrected in the source workbook.`}
              </span>
            </div>
          )}

          {(databaseStatus === "success" || databaseStatus === "duplicate" || databaseStatus === "error") && (
            <div className={`database-result ${databaseStatus}`} role={databaseStatus === "success" ? "status" : "alert"}>
              {databaseStatus === "success" ? <Check size={19} /> : <AlertCircle size={19} />}
              <span>{databaseMessage}</span>
            </div>
          )}

          <div className="metrics" aria-label="Processing summary">
            <div><span>Output records</span><strong>{result.rows.length.toLocaleString()}</strong></div>
            <div><span>Source rows</span><strong>{result.sourceRows.toLocaleString()}</strong></div>
            <div><span>Skipped rows</span><strong className={result.skippedRows ? "warn" : ""}>{result.skippedRows.toLocaleString()}</strong></div>
            <div><span>Reported issues</span><strong className={result.issues.length ? "warn" : ""}>{result.issues.length.toLocaleString()}</strong></div>
          </div>

          {result.issues.length > 0 && (
            <details className="issues-panel">
              <summary><AlertCircle size={17} /> {result.issues.length} processing issue{result.issues.length === 1 ? "" : "s"} reported</summary>
              <div className="issue-list">
                {result.issues.slice(0, 100).map((issue, index) => (
                  <div key={`${issue.sourceRow}-${index}`}><span>Row {issue.sourceRow}</span><p>{issue.reason}</p></div>
                ))}
                {result.issues.length > 100 && <p className="more-issues">Showing the first 100 issues.</p>}
              </div>
            </details>
          )}

          <div className="table-shell">
            <div className="table-toolbar"><span>Preview</span><span>Rows {result.rows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, result.rows.length)} of {result.rows.length.toLocaleString()}</span></div>
            <div className="table-scroll"><table>
              <thead><tr>{OUTPUT_COLUMNS.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>{visibleRows.map((row, rowIndex) => (
                <tr key={`${page}-${rowIndex}`}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>
              ))}</tbody>
            </table></div>
            <div className="pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ArrowLeft size={16} /> Previous</button>
              <span>Page <strong>{page}</strong> of {pageCount}</span>
              <button type="button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={16} /></button>
            </div>
          </div>
        </section>
      )}

      {showDatabaseConfirm && result && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDatabaseConfirm();
        }}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="database-confirm-title">
            <div className="dialog-icon"><Database size={24} /></div>
            <h2 id="database-confirm-title">Append records to PostgreSQL?</h2>
            <p>
              {duplicateCheck
                ? <>This will add the <strong>{duplicateCheck.fresh.toLocaleString()} new record{duplicateCheck.fresh === 1 ? "" : "s"}</strong> to <code>public.rate_analysis_test_environment</code>. Existing records will not be changed.</>
                : <>This will add up to <strong>{result.rows.length.toLocaleString()} records</strong> to <code>public.rate_analysis_test_environment</code>. Existing records will not be changed.</>}
            </p>
            <label className="dialog-field">
              <span>Database upload passcode</span>
              <input
                type="password"
                value={databasePassword}
                onChange={(event) => setDatabasePassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <div className="dialog-warning" role={duplicateCheck ? "alert" : undefined}>
              <AlertCircle size={17} />
              {duplicateCheck
                ? (
                  <span>
                    {duplicateCheck.stored > 0 && (
                      <><strong>{duplicateCheck.stored.toLocaleString()} of {duplicateCheck.total.toLocaleString()} records are already in the database</strong> and will be skipped. </>
                    )}
                    {duplicateCheck.repeated > 0 && (
                      <><strong>{duplicateCheck.repeated.toLocaleString()} of {duplicateCheck.total.toLocaleString()} records are repeated inside this workbook</strong> and will be added once rather than twice. </>
                    )}
                    Continue to append the {duplicateCheck.fresh.toLocaleString()} remaining record{duplicateCheck.fresh === 1 ? "" : "s"}.
                  </span>
                )
                : <span>Records already in the database are detected and skipped, so repeating an upload will not create duplicates.</span>}
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeDatabaseConfirm}>Cancel</button>
              <button
                className="database-button"
                type="button"
                disabled={!databasePassword || databaseStatus === "checking" || databaseStatus === "uploading"}
                onClick={() => void checkThenAppend()}
              >
                {databaseStatus === "checking" ? <><LoaderCircle className="spin" size={17} /> Checking for duplicates…</>
                  : duplicateCheck ? <><Database size={17} /> Upload {duplicateCheck.fresh.toLocaleString()} new record{duplicateCheck.fresh === 1 ? "" : "s"}</>
                  : <><Database size={17} /> Upload to Database</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
