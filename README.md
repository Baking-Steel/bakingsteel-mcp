# Baking Steel MCP

A free, public MCP that scopes an AI assistant to Baking Steel's public
recipes, technique writing, and catalog. No Shopify Admin app — only public
pages, plus optional Vercel Blob to hold the weekly scrape.

**Repo:** https://github.com/Baking-Steel/bakingsteel-mcp  
**Connector:** `https://bakingsteel-mcp.vercel.app/mcp`

## Design

- **Products are live** from `https://bakingsteel.com/products.json` (no key).
- **Recipes/posts** come from a curated seed (`data/corpus.json`), refreshed by a
  **weekly public scrape** that writes `corpus.json` to Vercel Blob. Blob is a
  file for scraped HTML/JSON — not a database and not a Shopify integration.
- **Cron stays under Vercel's ~5 minute limit** by scraping at most ~90 pages per
  run (2 concurrent, polite gaps, 4-minute budget). New sitemap URLs go first;
  the rest rotates weekly so the full archive revalidates over a few weeks.
- **No embeddings.** BM25 over a few hundred docs is enough.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_recipes` | Search the recipe and technique archive |
| `get_recipe` | Full text of one recipe by id |
| `troubleshoot` | Diagnose a failed bake from the symptom |
| `find_products` | Catalog with live prices, variants, availability |
| `create_cart` | Build a pre-filled cart link |

## Vercel (optional freshness)

Without these, the MCP still works from the committed seed + live products.

| Variable | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Save/load the weekly scrape JSON (create a Blob store on the project) |
| `CRON_SECRET` | Bearer token for `/api/cron/refresh` |

Cron: Mondays 06:00 UTC → `GET /api/cron/refresh`  
(`vercel.json`: `0 6 * * 1`, `maxDuration` 300s, scrape self-stops ~240s)

Manual trigger:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://bakingsteel-mcp.vercel.app/api/cron/refresh
```

## Local seed update

```bash
npm run ingest:shopify   # public pages; optional local Admin token only speeds this up
```

Commit `data/corpus.json` when you want the git seed updated. YouTube:
`npm run ingest:youtube`.

## Attribution

Outbound links use `utm_source=claude&utm_medium=mcp`.
