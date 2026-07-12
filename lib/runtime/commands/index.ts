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

export { addSeedReferenceCommand } from "./seed-capture";

export {
  getFigmaConnectionStatusCommand,
  connectFigmaCommand,
  disconnectFigmaCommand,
  requireFigmaConnectionCommand
} from "./figma-connection";

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
  addSeedReferenceInputSchema,
  addSeedReferenceInputShape,
  connectFigmaInputSchema,
  connectFigmaInputShape,
  createOrOpenProjectInputShape,
  setupWorkspaceInputShape
} from "./schemas";

export { commandErrorHttpStatus } from "./http-status";
