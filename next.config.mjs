/** @type {import('next').NextConfig} */
const nextConfig = {
  // Receivers must never be cached; route handlers opt out explicitly, but keep the app dynamic-safe.
  poweredByHeader: false,
};

export default nextConfig;
