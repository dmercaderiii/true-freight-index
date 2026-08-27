# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

TrueFreight Index (package name `rateflow-converter`) is a Next.js 16 app that converts logistics rate Excel workbooks into a normalized, headerless 12-column CSV. Parsing and transformation run in a Web Worker so the UI stays responsive. Reviewed records can optionally be appended to a PostgreSQL table.

## Commands

```bash
npm run dev      # next dev --webpack
npm run build    # next build --webpack
npm start        # next start
npm test         # vitest run
npm run lint     # eslint app lib tests
```

Always run `npm test` and `npm run lint` after making changes — there is no CI configured in this repo, so these are the only checks in place.

## Architecture

- [app/page.tsx](app/page.tsx) — the single-page client UI: upload, drag/drop, paginated preview (75 rows/page), CSV download, and the database-upload confirmation dialog.
- [app/rate-worker.ts](app/rate-worker.ts) — Web Worker entry point. Reads the `.xlsx` buffer with the `xlsx` package and calls into `lib/rate-transformer.ts`. Spawned from `page.tsx` via `new Worker(new URL("./rate-worker.ts", import.meta.url))`.
- [lib/rate-transformer.ts](lib/rate-transformer.ts) — the core transform: validates the A–L source headers, expands slash-separated Origin/Origin Via/Destination/Destination Via into all combinations, expands 20/40/40HC into container rows, maps `CEA-USEC`/`CEA-USWC` into USEC/USWC coast columns, formats dates as `M/D/YYYY`, sorts output, and builds the escaped CSV. Pure functions, no I/O — this is where most business-logic changes belong.
  - `validateSourceRow` rejects a source row outright (reporting an `error` issue per problem) when Trade is not `CEA-USEC`/`CEA-USWC`, the Eff Date does not fall on day 1/8/15/22, Origin or Destination is off the approved port list, the Destination's required coast disagrees with Trade, or Origin/Destination/Trade is blank. The approved values are the exported `APPROVED_EFF_DATE_DAYS`, `APPROVED_ORIGINS`, and `APPROVED_DESTINATIONS` constants — edit those rather than the checks. Port matching is case- and whitespace-insensitive and runs per slash-split part.
  - The UI blocks CSV download and database upload whenever `issues` is non-empty, so any new issue — warning or error — makes a workbook non-exportable.
- [lib/database-records.ts](lib/database-records.ts) — validates and converts output rows (the `OutputRow` tuple) into `DatabaseRateRecord` objects for insertion (numeric checks, date format checks, row-count cap at 50,000).
  - `recordKey` / `partitionNewRecords` implement duplicate detection. A record's identity is the `IDENTITY_COLUMNS` — the ten non-rate columns — so a row whose lane and date match an existing row is skipped even if its rate changed. Matching is an exact, case-sensitive string compare. `partitionNewRecords` also collapses rows that repeat within one payload.
- [app/api/database-upload/route.ts](app/api/database-upload/route.ts) — server-only Next.js route handler (`runtime = "nodejs"`). Checks a shared passcode (`DATABASE_UPLOAD_PASSWORD`) with a timing-safe comparison, then selects the stored identities for the payload's effective dates, filters out duplicates, and inserts batches of 500 rows into `public.rate_analysis_test_environment` via the `postgres` package inside a transaction.
  - `mode: "check"` in the request body runs the same comparison and returns `{ total, duplicates, fresh }` without writing; anything else inserts and returns `{ total, duplicates, inserted }`. The UI checks first so it can refuse an entirely duplicate upload and ask for confirmation on a partly duplicate one — see `checkThenAppend` in `page.tsx`.
  - The check and the insert run in the same transaction, but two concurrent uploads can still both pass it. Only a unique index on `IDENTITY_COLUMNS` would make this airtight; none exists yet.
- [app/chatgpt-auth.ts](app/chatgpt-auth.ts) — helpers for reading ChatGPT Apps SDK auth headers (`oai-authenticated-user-*`). Currently not imported anywhere in the app; leftover from an earlier integration attempt. Don't assume it's wired up.

Tests in [tests/](tests) mirror the `lib/` and `app/api/` modules 1:1 (`rate-transformer.test.ts`, `database-records.test.ts`, `database-upload-route.test.ts`). Add tests alongside logic changes in the matching file.

## Environment variables

Server-only, required for the database-upload feature (absent in local dev unless you set them):

- `DATABASE_URL` — full PostgreSQL connection string, `sslmode=require`.
- `DATABASE_UPLOAD_PASSWORD` — shared passcode checked against the `x-database-upload-password` request header.

Without these, `/api/database-upload` returns `503` and the converter/CSV-download flow still works fully offline.

## Deployment

Hosted on Vercel (see [README.md](README.md)); Next.js is auto-detected, root directory is the repo root, default build settings. A prior iteration targeted Cloudflare Workers — `.wrangler/`, `dist/`, `worker/`, `db/`, and `drizzle/` are leftovers from that attempt and are not part of the current (Vercel/Postgres) architecture. Don't extend them; if touching deployment config, Vercel is the current target.

## Conventions

- TypeScript strict, ESLint flat config (`eslint.config.mjs`) with `@next/eslint-plugin-next`, `typescript-eslint`, `react`/`react-hooks`, and `jsx-a11y` — fix lint errors rather than disabling rules, unless there's a specific documented reason (see the one existing `eslint-disable-next-line` in `page.tsx` for the pattern).
- No CSS framework beyond Tailwind v4 (`app/globals.css` + `postcss.config.mjs`); this app is a single page, not a component library — keep additions consistent with the existing flat, utility-light style in `page.tsx`.
- Never log or expose `DATABASE_URL` or `DATABASE_UPLOAD_PASSWORD`. If a Postgres password has ever been shared in chat, code, or a screenshot, treat it as compromised — flag it, don't reuse it.
