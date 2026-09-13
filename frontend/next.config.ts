import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // xrpl.js relies on Node APIs (ws, crypto); keep it out of the RSC bundle.
  serverExternalPackages: ["xrpl"],
  // Self-contained server for the Docker image (traces xrpl and its deps into .next/standalone).
  output: "standalone",
};

export default nextConfig;
