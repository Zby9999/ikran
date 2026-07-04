import type { NextConfig } from "next";

// `distDir` defaults to `.next`. Overridable via `IKRAN_NEXT_DIST_DIR` so
// parallel e2e workers can each spawn their own `next dev` against an isolated
// build cache — multiple dev servers sharing one `.next/` would corrupt each
// other's chunks. Production leaves this unset → `.next`.
const distDir = process.env.IKRAN_NEXT_DIST_DIR ?? ".next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir
};

export default nextConfig;
