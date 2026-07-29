// Shared SQLite reader for Playwright specs that inspect a project DB
// directly. Sets busy_timeout like the Runtime's own connections do
// (lib/runtime/db.ts): under full-suite parallelism the Runtime process can
// hold a write lock when the test reads, and without this pragma the read
// fails immediately with `database is locked`.

export function openIkranDb(dbPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
