/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // ws: false needed on both sides — viem bundles WebSocket transport which
    // imports 'ws' via isows, but we only use http transports
    config.resolve.fallback = {
      ...config.resolve.fallback,
      ws: false,
    };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
