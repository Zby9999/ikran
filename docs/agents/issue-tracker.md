# Issue tracker: Local Markdown (`Issues 02/`)

Implementation issues and specs for this repo live as markdown files under `Issues 02/`.

`Design issue/` is designer communication only — not part of this tracker. Do not create or triage engineering tickets there.

## Conventions

- Flat directory: `Issues 02/<NN>-<slug>.md` (or `NNX` suffixes like `04A`), numbered to continue the existing sequence — never a single combined tickets file
- Specs / PRDs may live at the repo root or under `docs/`; when a skill produces a feature-scoped spec next to tickets, prefer `Issues 02/spec.md` or a clearly named sibling unless the user points elsewhere
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `Issues 02/` using the next available `NN-slug.md` number (scan existing filenames; do not reuse numbers).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `Issues 02/map.md` — the Notes / Decisions-so-far / Fog body. (If absent, `Issues 02/README.md` may serve as orientation only; do not overwrite its product overview without asking.)
- **Child ticket**: `Issues 02/NN-<slug>.md`, continuing the existing numbering, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `Issues 02/` for issue files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
