import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript errors fixed (18.03.2026)
  // typescript: { ignoreBuildErrors: true }, // Removed - all errors fixed
  eslint: { ignoreDuringBuilds: false },
  outputFileTracingIncludes: {
    "/*": [
      "./prisma/schema.prisma",
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
  
};

export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  silent: true,
  // Hides the CLI output from Sentry instrumentation to keep build logs concise.
});
