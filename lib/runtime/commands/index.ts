// Shared command kernel — HTTP routes and MCP tools call these handlers.

export {
  getProjectStateCommand,
  requireActiveProjectCommand,
  bindProjectCommand,
  projectPathsMatch
} from "./project";

export {
  listSeedReferencesCommand,
  deleteSeedReferenceCommand,
  updateSeedReferenceNoteCommand
} from "./seed-reference";

export {
  addSeedReferenceCommand,
  refreshSeedReferenceCommand
} from "./seed-capture";

export {
  getSeedReferenceContext,
  getAnnotationNodeCandidatesContext,
  getCapturedNodeCorrespondence
} from "../figma-context";

export {
  getProjectReadinessCommand,
  getDesignLanguageDescriptionCommand,
  setDesignLanguageDescriptionCommand
} from "./project-readiness";

export {
  getFigmaConnectionStatusCommand,
  connectFigmaCommand,
  disconnectFigmaCommand,
  requireFigmaConnectionCommand
} from "./figma-connection";

export { listEvidenceSurfacesCommand } from "./evidence-package";

export {
  createRegionAnnotationCommand,
  confirmAnnotationPrimaryNodeCommand,
  listRegionAnnotationsCommand,
  deleteRegionAnnotationCommand,
  updateRegionAnnotationBodyCommand
} from "./region-annotation";

export {
  getWorkbenchLayoutCommand,
  putWorkbenchLayoutCommand
} from "./workbench-layout";

export {
  appendAgentAnnotationInformationCommand,
  completeDesignIntentAlignmentCommand,
  createAgentAnnotationCommand,
  createAlignmentQuestionCardCommand,
  readDesignIntentAlignmentCommand,
  recordDesignerAnswerCommand,
  updateAlignmentQuestionAnchorCommand,
  updateAlignmentQuestionTitleCommand
} from "./design-intent-alignment";

export {
  prepareDesignIntentAlignmentCommand,
  readAlignmentPreparationCommand
} from "./alignment-preparation";

export {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparationCommand
} from "./alignment-agent-command";

export { abandonCurrentAlignmentAttemptCommand } from "./alignment-attempt-lifecycle";

export {
  parseCommandInput,
  createRegionAnnotationInputSchema,
  createRegionAnnotationInputShape,
  confirmAnnotationPrimaryInputSchema,
  updateRegionAnnotationBodyInputSchema,
  addSeedReferenceInputSchema,
  addSeedReferenceInputShape,
  refreshSeedReferenceInputSchema,
  refreshSeedReferenceInputShape,
  getSeedReferenceContextInputSchema,
  getAnnotationNodeCandidatesInputSchema,
  getCapturedNodeCorrespondenceInputSchema,
  updateSeedReferenceNoteInputSchema,
  updateSeedReferenceNoteInputShape,
  setDesignLanguageDescriptionInputSchema,
  setDesignLanguageDescriptionInputShape,
  connectFigmaInputSchema,
  connectFigmaInputShape,
  createOrOpenProjectInputShape,
  setupWorkspaceInputShape
} from "./schemas";

export {
  alignmentAnchorSchema,
  appendAgentAnnotationInformationInputSchema,
  createAgentAnnotationInputSchema,
  createAlignmentQuestionCardInputSchema,
  finalizeAlignmentPreparationInputSchema,
  recordDesignerAnswerInputSchema,
  updateAlignmentQuestionAnchorInputSchema,
  updateAlignmentQuestionTitleInputSchema
} from "./schemas";

export { commandErrorHttpStatus } from "./http-status";
