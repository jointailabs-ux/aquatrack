/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
