import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@flowstate/types'],
};

export default nextConfig;
