import type { NextConfig } from "next";

const nextConfig = {
  experimental: {
    webpackMemoryOptimizations: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
