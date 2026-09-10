/**
 * Shopify fetchers shared by the CLI ingest and the Vercel cron refresh.
 *
 * Products use the public storefront JSON API — no credentials.
 * Articles prefer the Admin GraphQL API when SHOPIFY_ADMIN_TOKEN is set
 * (Vercel env only; never commit the token).
 */

import type { Doc, ProductVariant } from "../types";
import { htmlToText, summarize } from "../html";

export const STORE = "https://bakingsteel.com";
export const UA = { "user-agent": "bakingsteel-mcp/0.1" };

const MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url: string): Promise<string> {
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res.text();

    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;

    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * 2 ** attempt;
    await sleep(Math.min(backoff, MAX_BACKOFF_MS));
  }

  throw new Error(`GET ${url} -> ${lastStatus}`);
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  product_type: string;
  tags: string[] | string;
  published_at: string;
  variants: { id: number; title: string; price: string; available: boolean }[];
  images: { src: string }[];
}

/** Live catalog from the public storefront — no API key. */
export async function fetchProducts(): Promise<Doc[]> {
  const { products } = await fetchJson<{ products: ShopifyProduct[] }>(
    `${STORE}/products.json?limit=250`,
  );

  return products.map((p) => {
    const variants: ProductVariant[] = p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      price: Number(v.price),
      available: v.available,
    }));
    const prices = variants.map((v) => v.price);
    const body = htmlToText(p.body_html);

    return {
      id: `product:${p.handle}`,
      kind: "product" as const,
      title: p.title,
      url: `${STORE}/products/${p.handle}`,
      summary: summarize(body),
      body,
      tags: Array.isArray(p.tags)
        ? p.tags
        : String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      publishedAt: p.published_at,
      product: {
        handle: p.handle,
        productType: p.product_type,
        priceMin: prices.length ? Math.min(...prices) : 0,
        priceMax: prices.length ? Math.max(...prices) : 0,
        available: variants.some((v) => v.available),
        variants,
        imageUrl: p.images?.[0]?.src,
      },
    } satisfies Doc;
  });
}

/**
 * Full recipe/article archive via Admin GraphQL. Token must come from the
 * environment (Vercel / local .env) — never from the repo.
 */
export async function fetchArticlesViaAdmin(token: string): Promise<Doc[]> {
  const endpoint = `${STORE}/admin/api/2025-01/graphql.json`;
  const query = `
    query Articles($cursor: String) {
      articles(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          handle
          title
          body
          summary
          publishedAt
          tags
          blog { handle }
        }
      }
    }
  `;

  interface ArticleNode {
    handle: string;
    title?: string;
    body?: string;
    summary?: string;
    publishedAt?: string;
    tags?: string[];
    blog?: { handle?: string };
  }

  interface ArticlesResponse {
    data?: {
      articles: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        nodes: ArticleNode[];
      };
    };
    errors?: unknown;
  }

  const docs: Doc[] = [];
  let cursor: string | null = null;

  do {
    const res: Response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": token,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });

    if (!res.ok) throw new Error(`Admin API -> ${res.status} ${await res.text()}`);

    const payload = (await res.json()) as ArticlesResponse;
    if (payload.errors || !payload.data) {
      throw new Error(`Admin API: ${JSON.stringify(payload.errors)}`);
    }

    const page = payload.data.articles;
    for (const node of page.nodes) {
      const body = htmlToText(node.body ?? "");
      if (!body) continue;

      const blogHandle = node.blog?.handle ?? "recipes";
      docs.push({
        id: `blog:${node.handle}`,
        kind: blogHandle === "recipes" ? "recipe" : "article",
        title: node.title?.trim() ?? "",
        url: `${STORE}/blogs/${blogHandle}/${node.handle}`,
        summary: node.summary?.trim() || summarize(body),
        body,
        tags: [blogHandle, ...(node.tags ?? [])],
        publishedAt: node.publishedAt ?? undefined,
      });
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return docs.filter((d) => d.title && d.body);
}
