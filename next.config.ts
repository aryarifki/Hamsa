import type { NextConfig } from "next";

const config: NextConfig = {
  // The public tunnel previously cached a 404 for one old `/_next` chunk.
  // Namespace the Hamsa bundle so every deployment gets a fresh asset URL.
  assetPrefix: "/hamsa-assets",
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/hamsa-assets/_next/:path*", destination: "/_next/:path*" },
      { source: "/osiris", destination: "http://127.0.0.1:3102/osiris" },
      { source: "/osiris/:path*", destination: "http://127.0.0.1:3102/osiris/:path*" },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      // Next injects inline bootstrap scripts; 'unsafe-inline' is required
      // unless a nonce pipeline is added.
      "script-src 'self' 'unsafe-inline'",
      // MapLibre GL spawns its vector-tile worker as a blob: worker — without
      // worker-src blob: the worker is CSP-blocked and vector basemaps render
      // as a black canvas (raster basemaps are unaffected).
      "worker-src 'self' blob: data:",
      "connect-src 'self' https: wss:",
    ].join("; ");

    return [
      {
        source: "/osiris",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default config;
