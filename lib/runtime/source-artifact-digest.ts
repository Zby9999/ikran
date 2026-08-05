// Shared content-digest bookkeeping for design-system source artifacts.
//
// The lazy file→DB sync (design-system-sync) compares the source file's
// current bytes against the digest recorded here to spot undeclared drift.
// Every path that writes or ingests a design-system source file (declare,
// approve, edit, lazy re-ingest) must record the matching digest through
// these helpers — one place for the hash algorithm and the SQL, so no call
// site can drift and reintroduce the spurious-drift bug.

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** sha256 of the exact source-file bytes written or ingested. */
export function sourceContentDigestOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function recordSourceContentDigest(
  db: DatabaseSync,
  artifactPath: string,
  digest: string
): void {
  db.prepare("UPDATE source_artifacts SET content_digest = ? WHERE path = ?")
    .run(digest, artifactPath);
}
