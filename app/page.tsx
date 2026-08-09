"use client";

import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet,
  LoaderCircle, RefreshCcw, ShieldCheck, UploadCloud, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { OUTPUT_COLUMNS, type TransformationResult } from "../lib/rate-transformer";

type Status = "idle" | "processing" | "success" | "error";
const PAGE_SIZE = 75;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
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

  useEffect(() => () => workerRef.current?.terminate(), []);

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
      worker.onerror = () => {
        setError("The workbook could not be processed. Check that it is a valid .xlsx file and try again.");
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
    if (!result || !file) return;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name.replace(/\.xlsx$/i, "") + " - normalized.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RateFlow home">
          <span className="brand-mark"><FileSpreadsheet size={20} strokeWidth={2.2} /></span>
          <span>RateFlow</span>
        </a>
        <div className="privacy-note"><ShieldCheck size={16} /> Files stay in your browser</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">Rate normalization workspace</div>
        <h1>Excel rates in.<br /><span>Clean CSV out.</span></h1>
        <p>Convert carrier rate workbooks into a consistent 12-column CSV—split locations, normalized containers, and correctly placed coast rates included.</p>
      </section>

      <section className="workspace" aria-live="polite">
        <div className="section-heading">
          <div><span className="step-number">01</span><h2>Upload rate workbook</h2></div>
          <p>Required columns A–L · First worksheet · .xlsx only</p>
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
            <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>Choose workbook</button>
            <span className="file-hint">XLSX · processed privately on this device</span>
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
            <div><span className="step-number">02</span><h2>Review normalized data</h2><p>Showing all 12 output fields. The downloaded CSV has no header row.</p></div>
            <div className="result-actions">
              <button className="secondary-button" type="button" onClick={reset}><RefreshCcw size={17} /> Upload another</button>
              <button className="download-button" type="button" onClick={downloadCsv}><Download size={18} /> Download CSV</button>
            </div>
          </div>

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

      <section className="process-strip">
        <div><span>01</span><strong>Validate</strong><p>Checks all 12 source columns.</p></div>
        <div><span>02</span><strong>Expand</strong><p>Splits every location combination.</p></div>
        <div><span>03</span><strong>Normalize</strong><p>Unpivots rates and maps trades.</p></div>
        <div><span>04</span><strong>Export</strong><p>Produces an escaped, headerless CSV.</p></div>
      </section>
      <footer><span>RateFlow · Internal rate operations</span><span>Excel never leaves your device</span></footer>
    </main>
  );
}
