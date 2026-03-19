// @ts-check
const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'fullcountprops.vercel.app' }],
        destination: 'https://www.fullcountprops.com/:path*',
        permanent: true,
      },
      {
        source: '/subscribe',
        destination: '/pricing',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
}

module.exports = withSentryConfig(nextConfig, {
  // Suppress Sentry CLI output during builds
  silent: true,

  // Don't expose source maps in the client bundle
  hideSourceMaps: true,
})
