import type { NextConfig } from "next";

// Deliberately no cacheComponents — this app is 100% live client-side
// calls to the Jarvis Python API, none of kiv-console's Server-Component
// data-fetching/PPR patterns apply here.
//
// output: "export" emits a plain static bundle into web/out/, which the
// FastAPI app mounts at "/" (see app/main.py). That is what collapses
// Jarvis into a single server on a single port: there is no Next.js
// runtime in production at all. It is only viable because this app has
// one route and zero server-side surface — no route handlers, no
// middleware, no next/headers, no next/image. Adding any of those means
// revisiting this line.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
