# RateFlow

RateFlow converts logistics rate workbooks into a normalized, headerless 12-column CSV. Excel parsing and transformation run in a Web Worker so files remain in the browser and the interface stays responsive.

## Features

- Validates the expected A–L source columns.
- Expands slash-separated Origin, Origin Via, Destination, and Destination Via values into all combinations.
- Converts 20, 40, and 40HC rate columns into container rows.
- Maps CEA-USEC and CEA-USWC and places each rate in only its correct coast column.
- Formats dates as M/D/YYYY and sorts by Trade, then 20FT, 40FT, and 40HC.
- Previews 75 records per page and downloads the complete escaped CSV without a header row.
- Appends reviewed records to `public.tfx_test_environment` through a server-only PostgreSQL connection.
- Reports unsupported trades, invalid rates, and skipped source rows.

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run lint
npm run build
```

The database upload endpoint requires a server-only `DATABASE_URL` environment variable.
