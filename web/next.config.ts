import type { NextConfig } from "next";

// Deliberately no cacheComponents — this app is 100% live client-side
// calls to a separate backend (the Jarvis Python API), none of
// kiv-console's Server-Component data-fetching/PPR patterns apply here.
const nextConfig: NextConfig = {};

export default nextConfig;
