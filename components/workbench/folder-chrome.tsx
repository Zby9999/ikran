"use client";

import {
  ArrowLeft01Icon,
  ArtboardToolIcon,
  CrosshairIcon
} from "@hugeicons/core-free-icons";
import { SmallIconButton } from "./small-icon-button";
import { SquircleChrome } from "./squircle-chrome";

export type FolderChromeExtraction = {
  stageRemaining: number;
  stageTotal: number;
  overallRemaining: number;
  overallTotal: number;
  onFollowAgent?: () => void;
  onAnnotate?: () => void;
  /** When true, Annotate button shows pressed/active state. */
  annotateActive?: boolean;
};

export type FolderChromeProps = {
  folderName: string;
  onBack: () => void;
  /** Omit or pass null to hide the Extraction row (EnterPanel visible). */
  extraction?: FolderChromeExtraction | null;
};

export function FolderChrome({ folderName, onBack, extraction }: FolderChromeProps) {
  const showExtraction = extraction != null;

  return (
    <SquircleChrome
      className={
        showExtraction
          ? "seed-workbench__folder seed-workbench__folder--extraction"
          : "seed-workbench__folder"
      }
      surfaceClassName="seed-workbench__folder-body"
    >
      <div className="seed-workbench__folder-row">
        <div className="seed-workbench__folder-leading">
          <SmallIconButton icon={ArrowLeft01Icon} label="Back to setup" onClick={onBack} />
          <span className="seed-workbench__folder-name">{folderName || "Folder Name"}</span>
        </div>
        {showExtraction ? (
          <div className="seed-workbench__folder-actions">
            {/* CrosshairIcon is drawn at cx=11 in a 24 viewBox (1 unit left of
                center). Nudge via CSS so the glyph sits optically centered. */}
            <SmallIconButton
              className="small-icon-button--crosshair"
              icon={CrosshairIcon}
              label="Follow Agent view"
              data-testid="follow-agent-button"
              onClick={extraction.onFollowAgent}
            />
            <SmallIconButton
              icon={ArtboardToolIcon}
              label="Annotate on Figma"
              data-testid="annotate-button"
              data-active={extraction.annotateActive ? "true" : undefined}
              aria-pressed={extraction.annotateActive === true}
              onClick={extraction.onAnnotate}
            />
          </div>
        ) : null}
      </div>

      {showExtraction ? (
        <>
          <div className="seed-workbench__folder-divider" role="separator" />
          <div
            className="seed-workbench__folder-extraction"
            data-testid="seed-workbench-extraction"
          >
            <span className="seed-workbench__folder-extraction-label">Extraction</span>
            <div className="seed-workbench__folder-extraction-counts">
              <span
                className="seed-workbench__folder-extraction-stage"
                data-testid="extraction-stage-progress"
              >
                {extraction.stageRemaining}/{extraction.stageTotal}
              </span>
              <span
                className="seed-workbench__folder-extraction-overall"
                data-testid="extraction-overall-progress"
              >
                {extraction.overallRemaining}/{extraction.overallTotal}
              </span>
            </div>
          </div>
        </>
      ) : null}
    </SquircleChrome>
  );
}
