/** @type {import('next').NextConfig} */
const nextConfig = {
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

export default nextConfig;
