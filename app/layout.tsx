import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Baking Steel — Recipe Assistant",
  description:
    "Connect Baking Steel's full recipe archive to Claude and other AI assistants.",
};

const css = `
  :root {
    --bg: #fbfbfd;
    --fg: #1d1d1f;
    --muted: #6e6e73;
    --line: #d2d2d7;
    --card: #ffffff;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000;
      --fg: #f5f5f7;
      --muted: #86868b;
      --line: #2c2c2e;
      --card: #1c1c1e;
    }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--fg);
    font: 400 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  main { max-width: 640px; margin: 0 auto; padding: 120px 24px 160px; }

  h1 {
    font-size: 40px;
    line-height: 1.1;
    letter-spacing: -0.022em;
    font-weight: 600;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 20px;
  }

  .lede { font-size: 21px; line-height: 1.5; color: var(--muted); margin-top: 16px; }

  section { margin-top: 72px; }

  .url {
    display: block;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 15px;
    word-break: break-all;
  }

  ol { list-style: none; counter-reset: step; }

  ol li {
    counter-increment: step;
    position: relative;
    padding-left: 40px;
    margin-bottom: 18px;
  }

  ol li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 1px;
    width: 26px;
    height: 26px;
    border: 1px solid var(--line);
    border-radius: 50%;
    font-size: 13px;
    color: var(--muted);
    display: grid;
    place-items: center;
  }

  ul { list-style: none; }

  ul li {
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
  }

  ul li:first-child { padding-top: 0; }

  footer {
    margin-top: 96px;
    padding-top: 32px;
    border-top: 1px solid var(--line);
    font-size: 14px;
    color: var(--muted);
  }

  a { color: inherit; }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
