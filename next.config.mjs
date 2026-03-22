import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript errors fixed (18.03.2026)
  // typescript: { ignoreBuildErrors: true }, // Removed - all errors fixed
  eslint: { ignoreDuringBuilds: false },
  outputFileTracingIncludes: {
    "/*": [
      "./prisma/dev.db",
      "./prisma/schema.prisma",
      "./prisma/schema.sqlite.prisma",
      "./node_modules/.prisma/client/**/*",
    ],
  },
  
  productionBrowserSourceMaps: false,
  
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'recharts',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
    ],
  },
  
  webpack: (config, { isServer }) => {
    // Mark @libsql/client as external for client-side bundles
    // It should only be used in server-side code
    if (!isServer) {
      config.resolve.alias['@libsql/client'] = false;
      config.resolve.alias['@prisma/adapter-libsql'] = false;
    }
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // Hides the CLI output from Sentry instrumentation to keep build logs concise.
});
