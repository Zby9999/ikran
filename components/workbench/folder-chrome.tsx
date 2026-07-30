"use client";

import {
  ArrowLeft01Icon,
  ArtboardToolIcon,
  CrosshairIcon,
  Cursor02Icon
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { SmallIconButton } from "./small-icon-button";
import { SquircleChrome } from "./squircle-chrome";
import { cn } from "@/lib/utils";
import type { AlignmentQuestionSegment } from "./alignment-stage-panel";

export type FolderChromeExtraction = {
  segments: readonly AlignmentQuestionSegment[];
};

/** Post-gate folder stages (Figma 329:429). */
export type FolderChromePhase = "sign-seed" | "extraction";

export type FolderChromeProps = {
  folderName: string;
  onBack: () => void;
  backLabel?: string;
  /**
   * `null` — compact Default (back + name only).
   * `sign-seed` — Sign Seed Design + seed count + Next Phase.
   * `extraction` — Extraction progress stub.
   */
  phase?: FolderChromePhase | null;
  /** Seed reference count shown in Sign Seed Design (Figma 329:490). */
  seedCount?: number;
  extraction?: FolderChromeExtraction | null;
  onNextPhase?: () => void;
  onFollowAgent?: () => void;
  /** When true, Follow Agent button shows selected/active state (Figma 325:422). */
  followAgentActive?: boolean;
  onSelect?: () => void;
  /** When true, Select button shows selected/active state (Figma 329:461). */
  selectActive?: boolean;
  onAnnotate?: () => void;
  /** When true, Annotate button shows selected/active state (Figma 325:422). */
  annotateActive?: boolean;
};

function groupSegmentsByStage(
  segments: readonly AlignmentQuestionSegment[]
): { stageId: AlignmentQuestionSegment["stageId"]; segments: AlignmentQuestionSegment[] }[] {
  const groups: {
    stageId: AlignmentQuestionSegment["stageId"];
    segments: AlignmentQuestionSegment[];
  }[] = [];
  for (const segment of segments) {
    const last = groups[groups.length - 1];
    if (last && last.stageId === segment.stageId) {
      last.segments.push(segment);
    } else {
      groups.push({ stageId: segment.stageId, segments: [segment] });
    }
  }
  return groups;
}

export function FolderChrome({
  folderName,
  onBack,
  backLabel = "Back to setup",
  phase = null,
  seedCount = 0,
  extraction = null,
  onNextPhase,
  onFollowAgent,
  followAgentActive = false,
  onSelect,
  selectActive = false,
  onAnnotate,
  annotateActive = false
}: FolderChromeProps) {
  const showActions = phase === "sign-seed" || phase === "extraction";
  const showSignSeed = phase === "sign-seed";
  const showExtraction = phase === "extraction" && extraction != null;
  const answeredCount = extraction
    ? extraction.segments.filter((segment) => segment.answered).length
    : 0;
  const totalCount = extraction?.segments.length ?? 0;
  const segmentGroups = extraction
    ? groupSegmentsByStage(extraction.segments)
    : [];

  return (
    <SquircleChrome
      className={cn(
        "seed-workbench__folder",
        showActions && "seed-workbench__folder--expanded"
      )}
      surfaceClassName={cn(
        "seed-workbench__folder-body",
        !showActions && "seed-workbench__folder-body--compact"
      )}
      cornerRadius={14}
    >
      <div className="seed-workbench__folder-row">
        <div className="seed-workbench__folder-leading">
          <SmallIconButton
            className="seed-workbench__folder-back"
            icon={ArrowLeft01Icon}
            label={backLabel}
            onClick={onBack}
          />
          <span className="seed-workbench__folder-name">{folderName || "Folder Name"}</span>
        </div>
        {showActions ? (
          <div className="seed-workbench__folder-actions">
            {/* CrosshairIcon is drawn at cx=11 in a 24 viewBox (1 unit left of
                center). Nudge via CSS so the glyph sits optically centered. */}
            <SmallIconButton
              className="small-icon-button--crosshair"
              icon={CrosshairIcon}
              label="Follow Agent view"
              data-testid="follow-agent-button"
              data-active={followAgentActive ? "true" : undefined}
              aria-pressed={followAgentActive}
              onClick={onFollowAgent}
            />
            <SmallIconButton
              icon={Cursor02Icon}
              label="Select (V)"
              data-testid="select-button"
              data-active={selectActive ? "true" : undefined}
              aria-pressed={selectActive}
              onClick={onSelect}
            />
            <SmallIconButton
              icon={ArtboardToolIcon}
              label="Annotate on Figma (F)"
              data-testid="annotate-button"
              data-active={annotateActive ? "true" : undefined}
              aria-pressed={annotateActive}
              onClick={onAnnotate}
            />
          </div>
        ) : null}
      </div>

      {showSignSeed ? (
        <>
          <div className="seed-workbench__folder-divider" role="separator" />
          <div
            className="seed-workbench__folder-stage"
            data-testid="seed-workbench-sign-seed"
          >
            <div className="seed-workbench__folder-stage-row">
              <span className="seed-workbench__folder-stage-label">Sign Seed Design</span>
              <span
                className="seed-workbench__folder-stage-count"
                data-testid="sign-seed-count"
              >
                {seedCount}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="seed-workbench__folder-next"
              data-testid="sign-seed-next-phase"
              disabled={seedCount < 1}
              onClick={onNextPhase}
            >
              Next Phase
            </Button>
          </div>
        </>
      ) : null}

      {showExtraction ? (
        <>
          <div className="seed-workbench__folder-divider" role="separator" />
          <div
            className="seed-workbench__folder-extraction"
            data-testid="seed-workbench-extraction"
          >
            <span className="seed-workbench__folder-stage-label">Extraction</span>
            <div
              className="seed-workbench__folder-extraction-track"
              role="img"
              aria-label={`Extraction progress: ${answeredCount} of ${totalCount} questions answered`}
              data-testid="extraction-progress-track"
            >
              {segmentGroups.map((group) => (
                <span
                  key={group.stageId}
                  className="seed-workbench__folder-extraction-group"
                  data-stage={group.stageId}
                >
                  {group.segments.map((segment) => (
                    <span
                      key={segment.id}
                      className="seed-workbench__folder-extraction-bar"
                      data-answered={segment.answered ? "true" : "false"}
                      data-stage={segment.stageId}
                      style={
                        segment.answered
                          ? { backgroundColor: segment.color }
                          : undefined
                      }
                    />
                  ))}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </SquircleChrome>
  );
}
