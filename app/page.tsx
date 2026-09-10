import { getCorpusState } from "@/lib/corpus";

/** Always reflect Blob / live products — do not bake seed counts at build time. */
export const dynamic = "force-dynamic";

/**
 * Set NEXT_PUBLIC_MCP_URL in Vercel once a branded domain is pointed here.
 * Until then the deployment origin is the real connector address.
 */
const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://bakingsteel-mcp.vercel.app/mcp";

const EXAMPLES = [
  "My dough tore when I stretched it. What did I do wrong?",
  "Walk me through the 72-hour dough, starting tonight.",
  "My oven only reaches 500°F. Which steel should I get?",
  "What can I make on a griddle for breakfast?",
];

export default async function Home() {
  const { index, generatedAt, source, productsLive } = await getCorpusState();
  const recipes = index.all("recipe").length;
  const products = index.all("product").length;
  const rebuilt = new Date(generatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main>
      <h1>Baking Steel, in your AI assistant.</h1>
      <p className="lede">
        Every recipe and technique Andris Lagsdin has published, connected
        directly to Claude. Ask about dough, heat, or what to buy — answers come
        from his own writing, with links back to the source.
      </p>

      <section>
        <h2>Connect</h2>
        <code className="url">{MCP_URL}</code>
        <ol style={{ marginTop: 28 }}>
          <li>Open Claude, then Settings → Connectors.</li>
          <li>Choose Add custom connector and paste the address above.</li>
          <li>Start a new chat and ask anything about baking.</li>
        </ol>
      </section>

      <section>
        <h2>Try asking</h2>
        <ul>
          {EXAMPLES.map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
      </section>

      <footer>
        <p>
          {recipes} recipes and {products} products. Archive from {rebuilt}
          {" "}({source}
          {productsLive ? "; catalog live from the storefront" : ""}). Free to
          use. Nothing is purchased on your behalf — checkout always happens on{" "}
          <a href="https://bakingsteel.com">bakingsteel.com</a>.
        </p>
      </footer>
    </main>
  );
}
