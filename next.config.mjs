/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "clsx",
      "tailwind-merge",
    ],
  },
  async rewrites() {
    return [
      {
        source: "/dashboard/:path+",
        destination: "/:path+",
      },
    ];
  },
};

export default nextConfig;
