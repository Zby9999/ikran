---
name: ikran-prototype
description: Build or repair an Ikran seed-reconstruction prototype when a Workbench preview surface or live iframe is required.
---

# Ikran Prototype

## 1. Load the contract

Call `get_prototype_rebuild_context`. Treat its `rebuild_contract` and
`preview_contract` as the source of truth for reconstruction, file ownership,
server ownership, declaration order, and completion.

This step is complete when every Seed Reference has been read and the returned
contract fields are available for the handoff.

## 2. Build the complete handoff

Follow `preview_contract.sequence`. Write the complete prototype before its
preview declaration. Make the package metadata and dev script satisfy the
returned server contract, then declare every required artifact with
`record_artifact_written`.

This step is complete when the prototype entry and package metadata exist,
are declared, and can be named exactly by the `record_preview` fields.

## 3. Hand off once

Call `record_preview` once with explicit identity, artifact, root, route, and
the returned seed/evidence ids. Leave dependency installation and process
supervision to Runtime.

The handoff is complete only when the tool succeeds and the returned surface
matches `preview_contract.completion`.

## 4. Repair by diagnosis

On `preview_not_ready`, repair the returned typed diagnosis and retry using
`preview_contract.repair.retryIdentity`. Preserve the existing surface
identity. Stop with the typed failure when its cause requires missing designer
input or an unavailable external dependency.
