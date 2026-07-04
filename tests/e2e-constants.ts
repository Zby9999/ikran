// Shared constants for the e2e harness.
//
// SHARED_BUILD_DIR is the single `next build` output produced once in
// tests/global-setup.ts. Every worker's `next start` serves this same build
// (read-only) on its own port with its own IKRAN_STATE_DIR, so parallel workers
// don't each pay a compile cost and don't corrupt a shared distDir.
//
// It is a RELATIVE path (`.next/e2e-build`) on purpose, and lives under the
// repo's gitignored `.next/`:
//   - Relative, because Next 16 computes `next-env.d.ts` / `tsconfig.json`
//     references as `./` + distDir. With an ABSOLUTE distDir that produces
//     broken `".//Users/.../...` references that resolve under the repo root
//     and create junk `Users/` (or `var/`/`tmp/`) directories. A relative
//     distDir yields clean `./.next/e2e-build/...` references and no junk.
//   - Under `.next/` so it's already gitignored and doesn't collide with the
//     user's `npm run dev` (which uses `.next` directly).
// The committed tsconfig.json + next-env.d.ts are still snapshot/restored in
// globalSetup so they stay pristine.

import path from "node:path";

export const SHARED_BUILD_DIR = path.join(".next", "e2e-build");