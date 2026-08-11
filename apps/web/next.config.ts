import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@x/sdk', '@x/contracts', '@x/config'],
  webpack: (config) => {
    // Workspace packages import their own siblings with NodeNext-style
    // ".js" specifiers pointing at ".ts" source (required for tsx/tsc, see
    // CODESTYLE.md §4). Webpack doesn't do that remapping by default.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default nextConfig
