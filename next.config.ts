import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  turbopack: {},
  // NOTE: "ws" is intentionally NOT in serverExternalPackages — it must be
  // bundled into the standalone output so the QR-auth WebSocket client works
  // in production without requiring node_modules.
  serverExternalPackages: ["@prisma/client", "undici", "https-proxy-agent"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
      {
        protocol: "https",
        hostname: "discord.com",
      },
    ],
  },
  async headers() {
    return [
      {
        // Allow iframe embedding from any origin
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
