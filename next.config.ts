import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A lockfile in the parent directory makes Turbopack infer the wrong
  // workspace root, which breaks TypeScript resolution during build.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
