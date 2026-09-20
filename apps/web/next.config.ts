import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The browser talks to the backend directly; Next never proxies the WebSocket.
  // See docs/00-architecture.md §5.
};

export default nextConfig;
