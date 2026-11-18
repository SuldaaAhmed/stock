/** Backend API origin. The browser only ever calls relative /api/* URLs (same origin, cookie auth). */
const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${BACKEND_URL}/health`,
      },
    ];
  },
};

export default nextConfig;
