import type { NextConfig } from "next";

const CONSUMER_ORIGIN = process.env.CONSUMER_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/studio",
  assetPrefix: "/studio-static",
  transpilePackages: ["@bytedance-aigc/ui", "@bytedance-aigc/shared"],
  // 防误访:任何打到 studio 进程根 / 的请求,直接弹回 consumer 的 /studio。
  // basePath: false 让这条 redirect 不被 /studio 前缀污染,真的拦的是 host 根。
  async redirects() {
    return [
      {
        source: "/",
        destination: `${CONSUMER_ORIGIN}/studio/me/dashboard`,
        permanent: false,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
