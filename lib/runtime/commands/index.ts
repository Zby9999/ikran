// Shared command kernel — HTTP routes and MCP tools call these handlers.

export {
  getProjectStateCommand,
  requireActiveProjectCommand,
  bindProjectCommand,
  projectPathsMatch
} from "./project";

export {
  registerSeedReferenceCommand,
  listSeedReferencesCommand
} from "./seed-reference";

export {
  recordEvidencePackageCommand,
  listEvidenceSurfacesCommand
} from "./evidence-package";

export { listPendingSeedEvidenceCommand } from "./pending-seed-evidence";

export {
  createRegionAnnotationCommand,
  listRegionAnnotationsCommand,
  deleteRegionAnnotationCommand
} from "./region-annotation";

export {
  parseCommandInput,
  registerSeedReferenceInputSchema,
  registerSeedReferenceInputShape,
  recordEvidencePackageInputSchema,
  recordEvidencePackageInputShape,
  createRegionAnnotationInputSchema,
  createRegionAnnotationInputShape,
  createOrOpenProjectInputShape,
  setupWorkspaceInputShape
} from "./schemas";

export { commandErrorHttpStatus } from "./http-status";
