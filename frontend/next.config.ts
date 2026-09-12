import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // xrpl.js relies on Node APIs (ws, crypto); keep it out of the RSC bundle.
  serverExternalPackages: ["xrpl"],
};

export default nextConfig;
