import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  index,
  generatedAt,
  formatHit,
  formatProduct,
  withRef,
  STORE_URL,
} from "@/lib/corpus";

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
});

const NO_RESULTS =
  "No matches. Try different words — the archive indexes Andris's own phrasing, " +
  "so terms like 'cold ferment', 'launch', 'crumb', or 'preheat' land well.";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "search_recipes",
    {
      title: "Search recipes",
      description:
        "Search Baking Steel's recipe and technique archive — every recipe Andris " +
        "Lagsdin has published, including pizza doughs, breads, griddle cooking, and " +
        "searing. Returns titles, summaries, and ids. Call get_recipe for full text. " +
        "Search by dish, ingredient, technique, or constraint (for example: " +
        "'72 hour cold ferment', 'gluten free dough', 'smash burger', 'high hydration').",
      inputSchema: {
        query: z.string().describe("What to look for. Natural language is fine."),
        limit: z.number().int().min(1).max(20).optional()
          .describe("How many results to return. Defaults to 8."),
      },
    },
    async ({ query, limit }) => {
      const hits = index.search(query, {
        kinds: ["recipe", "article", "video"],
        limit: limit ?? 8,
      });

      if (hits.length === 0) return text(NO_RESULTS);
      return text(hits.map((h) => formatHit(h.doc)).join("\n\n"));
    },
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get recipe",
      description:
        "Fetch the complete text of one recipe or article by id, as returned by " +
        "search_recipes. Use this before answering a question about a specific " +
        "recipe, so the answer reflects what Andris actually wrote.",
      inputSchema: {
        id: z.string().describe("Document id, for example 'blog:72-hour-pizza-dough'."),
      },
    },
    async ({ id }) => {
      const doc = index.get(id);
      if (!doc) {
        return text(`No document with id '${id}'. Use search_recipes to find valid ids.`);
      }

      return text(
        [doc.title, withRef(doc.url), "", doc.body].join("\n"),
      );
    },
  );

  server.registerTool(
    "troubleshoot",
    {
      title: "Troubleshoot a result",
      description:
        "Diagnose something that went wrong — dough that tore, a pale or soggy crust, " +
        "a pizza that stuck to the peel, a steel that rusted or smoked. Searches the " +
        "archive for the passages where Andris addresses this failure directly. " +
        "Describe the symptom in the cook's own words.",
      inputSchema: {
        problem: z.string().describe("What went wrong, described plainly."),
      },
    },
    async ({ problem }) => {
      const hits = index.search(problem, {
        kinds: ["recipe", "article", "video"],
        limit: 5,
      });

      if (hits.length === 0) return text(NO_RESULTS);

      // Troubleshooting needs the actual passage, not a summary — send enough
      // body text to reason from, trimmed so several sources fit in one call.
      const passages = hits.map((h) => {
        const excerpt = h.doc.body.slice(0, 1200);
        const clipped = excerpt.length < h.doc.body.length ? `${excerpt}…` : excerpt;
        return [h.doc.title, withRef(h.doc.url), "", clipped].join("\n");
      });

      return text(passages.join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "find_products",
    {
      title: "Find products",
      description:
        "Search the Baking Steel catalog — steels, griddles, peels, dough mixes, and " +
        "accessories — with live prices, variants, and availability. Use it to answer " +
        "what to buy for a given oven, dish, or budget, and to get the variantId " +
        "needed by create_cart. Omit the query to list the full catalog.",
      inputSchema: {
        query: z.string().optional()
          .describe("What the cook needs, for example 'steel for Neapolitan' or 'peel'."),
      },
    },
    async ({ query }) => {
      const docs = query
        ? index.search(query, { kinds: ["product"], limit: 6 }).map((h) => h.doc)
        : index.all("product");

      if (docs.length === 0) {
        return text("No matching products. Omit the query to see the full catalog.");
      }

      return text(docs.map(formatProduct).join("\n\n"));
    },
  );

  server.registerTool(
    "create_cart",
    {
      title: "Create a cart link",
      description:
        "Build a Baking Steel checkout link pre-filled with the chosen items. Returns " +
        "a URL the cook opens themselves — this never places an order or takes " +
        "payment. Get variantIds from find_products first.",
      inputSchema: {
        items: z
          .array(
            z.object({
              variantId: z.number().int().describe("Variant id from find_products."),
              quantity: z.number().int().min(1).max(99).default(1),
            }),
          )
          .min(1)
          .describe("Items to put in the cart."),
      },
    },
    async ({ items }) => {
      const path = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
      const url = withRef(`${STORE_URL}/cart/${path}`);

      return text(
        [
          "Cart link — opens on bakingsteel.com with these items already added:",
          url,
          "",
          "Nothing has been purchased. The cook reviews and checks out themselves.",
        ].join("\n"),
      );
    },
  );

  server.registerResource(
    "corpus-info",
    "bakingsteel://corpus",
    {
      title: "Corpus freshness",
      description: "What this server indexes and when it was last rebuilt.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: [
            `Baking Steel archive, rebuilt ${generatedAt}.`,
            `${index.all("recipe").length} recipes`,
            `${index.all("article").length} technique articles`,
            `${index.all("video").length} videos`,
            `${index.all("product").length} products`,
          ].join("\n"),
        },
      ],
    }),
  );
}, {
  // Shown to users in the connector list, so name it for the brand rather
  // than leaving the adapter's default.
  serverInfo: { name: "baking-steel", version: "0.1.0" },
  instructions:
    "Baking Steel's published recipe and technique archive, plus the live " +
    "product catalog. Ground answers in what these tools return and link back " +
    "to the source so cooks can read Andris's full write-up.",
});

export { handler as GET, handler as POST, handler as DELETE };

