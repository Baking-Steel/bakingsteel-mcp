# Baking Steel MCP

A free, public MCP server that scopes an AI assistant to Baking Steel's public
recipes, technique writing, and catalog — curation over content that is already
on the open web. No Shopify app install, no database, no runtime secrets.

**Repo:** https://github.com/Baking-Steel/bakingsteel-mcp  
**Connector:** `https://bakingsteel-mcp.vercel.app/mcp`

## Design

One Next.js app on Vercel.

- **Recipes and posts** live in a committed seed (`data/corpus.json`) built from
  public storefront pages. Updating the archive is curation: run ingest, review,
  commit, push.
- **Products are live.** `find_products` reads the public
  `https://bakingsteel.com/products.json` (no API key) with a short in-memory
  cache so prices and availability stay current.
- **No integrations to maintain.** The MCP does not call Admin APIs or store
  credentials. Anyone can fork and deploy with zero env vars.
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

## Deploy

Pushing to `main` deploys. No environment variables are required.

Optional: `NEXT_PUBLIC_MCP_URL` if you point a branded domain at the deployment.

## Refreshing the curated archive (optional, local)

```bash
npm run ingest:shopify
```

That pulls public product JSON and public blog pages into `data/corpus.json`.
Commit the result when you want the seed updated. An optional local
`SHOPIFY_ADMIN_TOKEN` in `.env` only speeds up article ingest for maintainers —
it is never used by the deployed MCP.

YouTube transcripts: `npm run ingest:youtube` (yt-dlp), then commit.

## Attribution

Every outbound link carries `utm_source=claude&utm_medium=mcp`, so revenue
influenced by the assistant is measurable in Shopify Analytics.
