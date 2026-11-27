import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Không công khai "X-Powered-By: Next.js" và không xuất source map — người
  // ngoài không đọc được code gốc từ DevTools/production bundle.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
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
        // Chỉ chính domain này được nhúng app vào iframe (trước đây là ALLOWALL,
        // nghĩa là site lạ có thể iframe dựng lại UI và dụ người dùng).
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self';",
          },
          {
            // Ép HTTPS: token/phiên không bao giờ đi qua kết nối trơn.
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
