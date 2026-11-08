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
  async headers() {
    return [
      {
        // 서비스 워커는 브라우저 HTTP 캐시에 남으면 새 버전이 늦게 반영된다 (DEC-073)
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
