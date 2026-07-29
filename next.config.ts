import type { NextConfig } from "next";

const nextConfig = {
  experimental: {
    webpackMemoryOptimizations: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
