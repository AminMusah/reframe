import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Static export: no route handlers or server actions; Convex is the backend.
  output: "export",
  images: { unoptimized: true },
}

export default nextConfig
