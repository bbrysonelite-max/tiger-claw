import type { NextConfig } from "next";

// Validate required env vars at build time for production
if (process.env.NODE_ENV === "production") {
  const required = ["NEXT_PUBLIC_API_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[FATAL] Missing required environment variables for production build: ${missing.join(", ")}`
    );
  }
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
