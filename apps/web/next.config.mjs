/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@erp/contracts"],
  poweredByHeader: false,
  images: { unoptimized: true },
};
export default nextConfig;
