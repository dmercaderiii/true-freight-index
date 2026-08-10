# TrueFreight Index

TrueFreight Index converts logistics rate workbooks into a normalized, headerless 12-column CSV. Excel parsing and transformation run in a Web Worker so the interface stays responsive.

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

## Cloudflare Workers deployment

The repository includes a native Workers configuration for the free
`true-freight-index.<account-subdomain>.workers.dev` address.

In **Workers & Pages**, choose **Create application**, import this GitHub
repository, and use:

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npm run deploy:cloudflare:skip-build`
- Root directory: `/`

The first deployment should be completed without `DATABASE_URL`. The site will
work, but database uploads will stay disabled until access protection is in
place.

Before enabling database uploads:

1. In Cloudflare Zero Trust, add a self-hosted Access application for the
   `true-freight-index` Worker and select the Worker by name.
2. Use Cloudflare as the identity provider with **Restrict to account members**
   enabled. Add an Allow policy using **Cloudflare Account Member** for the
   current account. No email list or custom domain is required.
3. Rotate the PostgreSQL password if it has ever been shared in chat, source
   code, or screenshots.
4. In the Worker's **Settings > Variables and Secrets**, add `DATABASE_URL` as
   an encrypted secret. Use a PostgreSQL connection string with the database
   name included and `sslmode=require`.

The upload route accepts authenticated identity headers from the existing Sites
host or Cloudflare Access. Do not configure `DATABASE_URL` on a publicly
accessible Worker that is not protected by Access.
