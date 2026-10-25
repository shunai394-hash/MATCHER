import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Higgsfield-generated lifestyle photos for the SOY+ landing page.
      new URL("https://d8j0ntlcm91z4.cloudfront.net/user_3L5iapCiBz1VMC05NhTNVQsVbou/**"),
    ],
  },
};

export default nextConfig;
