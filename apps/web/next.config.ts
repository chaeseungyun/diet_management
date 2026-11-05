import type { NextConfig } from 'next';

/**
 * 웹과 API는 같은 오리진 (D-14).
 * 운영은 Caddy가 /api/* 를 NestJS로 보내므로 이 rewrite는 개발용(그리고 운영에서의 안전망)이다.
 */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
