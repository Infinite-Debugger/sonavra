import type { NextConfig } from 'next';

const apiOrigin =
  process.env.API_INTERNAL_URL ??
  `http://localhost:${process.env.API_PORT ?? '3001'}`;

const nextConfig: NextConfig = {
  transpilePackages: ['@sonavra/types'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
