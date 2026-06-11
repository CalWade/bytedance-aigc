import type { NextConfig } from "next";

const STUDIO_ORIGIN = process.env.STUDIO_ORIGIN ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@bytedance-aigc/ui", "@bytedance-aigc/shared"],
  async rewrites() {
    return [
      { source: "/studio", destination: `${STUDIO_ORIGIN}/studio` },
      { source: "/studio/:path+", destination: `${STUDIO_ORIGIN}/studio/:path+` },
      { source: "/studio-static/:path+", destination: `${STUDIO_ORIGIN}/studio-static/:path+` },
    ];
  },
};

export default nextConfig;
