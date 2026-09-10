# Baking Steel MCP

A free, public MCP server that gives Claude and other AI assistants Baking
Steel's full recipe archive and live product catalog.

**Repo:** https://github.com/Baking-Steel/bakingsteel-mcp  
**Connector:** `https://bakingsteel-mcp.vercel.app/mcp`

## Design

One Next.js app on Vercel. No database.

- **Products are live.** `find_products` reads
  `https://bakingsteel.com/products.json` (public, no API key) with a short
  in-memory cache. Prices and availability stay current without a deploy.
- **Recipes and posts refresh on a schedule.** A Vercel Cron job (every 6 hours)
  pulls the archive via the Shopify Admin API and writes `corpus.json` to
  Vercel Blob. The MCP serves that Blob, falling back to the committed seed in
  `data/corpus.json` if Blob is empty.
- **No secrets in GitHub.** Admin / Blob / cron credentials live only in the
  Vercel project environment. The public repo is safe to fork.
- **No embeddings.** BM25 over a few hundred documents is enough; the client
  model reformulates when results miss.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_recipes` | Search the recipe and technique archive |
| `get_recipe` | Full text of one recipe by id |
| `troubleshoot` | Diagnose a failed bake from the symptom |
| `find_products` | Catalog with live prices, variants, availability |
| `create_cart` | Build a pre-filled cart link |

`create_cart` returns a URL. It never places an order or handles payment —
checkout always happens on bakingsteel.com.

## Vercel setup (production freshness)

Set these on the `bakingsteel-mcp` Vercel project only — never commit them:

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_ADMIN_TOKEN` | Cron refreshes recipes/articles via Admin GraphQL |
| `BLOB_READ_WRITE_TOKEN` | Read/write the refreshed corpus on Vercel Blob |
| `CRON_SECRET` | Bearer token required by `/api/cron/refresh` |

Also create a Blob store for the project (Vercel dashboard → Storage → Blob).

Vercel Cron calls `GET /api/cron/refresh` every 6 hours with
`Authorization: Bearer $CRON_SECRET`. You can trigger the same URL manually
after rotating tokens.

Until the first successful cron run, the MCP serves the seed corpus in
`data/corpus.json` and still overlays live products.

Optional: `NEXT_PUBLIC_MCP_URL` if you point a branded domain at the deployment.

## Local ingest (optional)

For offline work or updating the seed file:

```bash
cp .env.example .env   # add SHOPIFY_ADMIN_TOKEN locally; never commit .env
npm run ingest:shopify
```

Without `SHOPIFY_ADMIN_TOKEN` the CLI falls back to scraping storefront pages,
which the store rate-limits. Production cron never uses that path.

YouTube transcripts remain a separate CLI step (`npm run ingest:youtube`);
cron preserves existing video docs when it refreshes Shopify content.

## Attribution

Every outbound link carries `utm_source=claude&utm_medium=mcp`, so revenue
influenced by the assistant is measurable in Shopify Analytics.
