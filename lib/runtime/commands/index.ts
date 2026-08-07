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

export { recordArtifactWrittenCommand } from "./artifact";

export { recordNewDesignRunCommand } from "./new-design-run";

export { getPrototypeRebuildContextCommand } from "./prototype-rebuild-context";

export { exportResearchCommand } from "./research-export";

export {
  getDesignSystemViewCommand,
  getDesignSystemComponentCommand,
  approveDesignSystemEntryCommand,
  editDesignSystemEntryCommand
} from "./design-system";

export {
  proposeRuleUpdateCommand,
  confirmRuleUpdateCommand,
  cancelRuleUpdateCommand
} from "./rule-update-proposal";

export { recordDesignerFeedbackCommand } from "./designer-feedback";

export {
  listPrototypeSurfacesCommand,
  recordPreviewCommand
} from "./prototype-preview";

export { captureRuleScreenshotCommand } from "./rule-capture";

export {
  claimConsolidateReviewCommand,
  dismissDesignerFeedbackCommand
} from "./consolidate-review";

export {
  getProjectPhaseCommand,
  requireProjectPhaseCommand,
  confirmDraftDesignSystemCommand,
  confirmPrototypeCommand,
  formalizeDesignSystemCommand,
  abandonProjectPhaseCommand
} from "./project-phase";

export {
  createRegionAnnotationCommand,
  confirmAnnotationPrimaryNodeCommand,
  listRegionAnnotationsCommand,
  deleteRegionAnnotationCommand,
  restoreRegionAnnotationCommand,
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

export {
  claimInitialDesignSystemPreparationCommand,
  finalizeInitialDesignSystemPreparationCommand,
  recordDesignSystemExtractionAuditCommand,
  recordDesignSystemExtractionWorkUnitCommand
} from "./initial-design-system-preparation";

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
  recordArtifactWrittenInputSchema,
  recordArtifactWrittenInputShape,
  getDesignSystemComponentInputSchema,
  getDesignSystemComponentInputShape,
  approveDesignSystemEntryInputSchema,
  approveDesignSystemEntryInputShape,
  editDesignSystemEntryInputSchema,
  editDesignSystemEntryInputShape,
  proposeRuleUpdateInputSchema,
  proposeRuleUpdateInputShape,
  confirmRuleUpdateInputSchema,
  confirmRuleUpdateInputShape,
  cancelRuleUpdateInputSchema,
  cancelRuleUpdateInputShape,
  claimConsolidateReviewInputSchema,
  claimConsolidateReviewInputShape,
  dismissDesignerFeedbackInputSchema,
  dismissDesignerFeedbackInputShape,
  recordDesignerFeedbackInputSchema,
  recordDesignerFeedbackInputShape,
  recordPreviewInputSchema,
  recordPreviewInputShape,
  captureRuleScreenshotInputSchema,
  captureRuleScreenshotInputShape,
  recordNewDesignRunInputSchema,
  recordNewDesignRunInputShape,
  createOrOpenProjectInputShape,
  setupWorkspaceInputShape
} from "./schemas";

export {
  alignmentAnchorSchema,
  appendAgentAnnotationInformationInputSchema,
  createAgentAnnotationInputSchema,
  createAlignmentQuestionCardInputSchema,
  finalizeAlignmentPreparationInputSchema,
  finalizeInitialDesignSystemPreparationInputSchema,
  recordDesignSystemExtractionAuditInputSchema,
  recordDesignSystemExtractionWorkUnitInputSchema,
  recordDesignerAnswerInputSchema,
  updateAlignmentQuestionAnchorInputSchema,
  updateAlignmentQuestionTitleInputSchema
} from "./schemas";

export { commandErrorHttpStatus } from "./http-status";
