import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    webpackMemoryOptimizations: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  allowedDevOrigins: [
    "alright-ultimatum-defog.ngrok-free.dev",
    "*.ngrok-free.dev",
  ],
};

export default nextConfig;