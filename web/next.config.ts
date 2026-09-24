import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker image can run without node_modules.
  output: "standalone",
};

export default nextConfig;
