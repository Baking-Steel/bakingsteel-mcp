# Baking Steel MCP

A free, public MCP server that gives Claude and other AI assistants Baking
Steel's full recipe archive and live product catalog.

## Design

The whole system is one Next.js app on Vercel and one committed JSON file.

- **No database.** The corpus is ~300 documents, roughly half a megabyte. It is
  imported directly into the route bundle, so a cold start needs no filesystem,
  no network, and no connection pool.
- **No runtime secrets.** Credentials are used at ingest time only. The deployed
  server reads none, which is why it can be public and unauthenticated.
- **No embeddings.** BM25 over 300 documents scans in well under a millisecond.
  The MCP client is itself a capable model that reformulates and re-queries when
  results miss, which covers most of what a vector store would buy here.

Updating content is `npm run ingest` followed by `git push`.

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

## Ingest

    cp .env.example .env
    npm run ingest:shopify

Without `SHOPIFY_ADMIN_TOKEN` the ingest falls back to reading 298 storefront
pages, which the store aggressively rate-limits; expect it to take a while.
Results are cached under `.cache/articles`, so a throttled run resumes rather
than restarting. With an Admin token the same content arrives in a few
paginated API calls.

Two source quirks worth knowing:

- The per-blog Atom feeds ignore `?page=` and always return the newest 30
  entries, so they cannot enumerate the archive.
- Article bodies live in `<script type="application/json">`, not the
  `application/ld+json` block you would expect.

## Deploy

Push to Vercel. The connector address is the deployment origin plus `/mcp`.

## Attribution

Every outbound link carries `utm_source=claude&utm_medium=mcp`, so revenue
influenced by the assistant is measurable in Shopify Analytics.
