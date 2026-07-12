"use client";

import {
  Add01Icon,
  ArrowUpRight03Icon,
  Tick02Icon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState, type FormEvent } from "react";
import { SquircleChrome } from "./squircle-chrome";
import { SmallIconButton } from "./small-icon-button";
import { FigmaLogoMark } from "./icons/figma-logo-mark";

export const FIGMA_TOKEN_HELP_URL =
  "https://www.figma.com/developers/api#access-tokens";

export type FigmaVerificationPanelPhase =
  | "empty"
  | "ready"
  | "checking"
  | "verified"
  | "error";

export type FigmaVerificationPanelProps = {
  phase: FigmaVerificationPanelPhase;
  token: string;
  error?: string | null;
  onTokenChange: (value: string) => void;
  onCheck: () => void;
  onEnterCanvas: () => void;
};

/**
 * Figma Connection Gate panel (Figma 309:400).
 * States: empty → ready (+ check) → verified (check + Enter Canvas).
 */
export function FigmaVerificationPanel({
  phase,
  token,
  error,
  onTokenChange,
  onCheck,
  onEnterCanvas
}: FigmaVerificationPanelProps) {
  const inputId = useId();
  const showCheck = phase === "ready" || phase === "checking";
  const showVerified = phase === "verified";
  const showEnter = phase === "verified";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase === "ready") onCheck();
    else if (phase === "verified") onEnterCanvas();
  }

  return (
    <SquircleChrome
      className="figma-verification-panel"
      surfaceClassName="figma-verification-panel__body"
      surfaceProps={{
        "data-testid": "figma-verification-panel",
        "data-phase": phase
      }}
    >
      <div className="figma-verification-panel__intro">
        <div className="figma-verification-panel__logo" aria-hidden="true">
          <FigmaLogoMark />
        </div>
        <p className="figma-verification-panel__title">Connect Figma</p>
        <p className="figma-verification-panel__copy">
          Ikran needs a read-only Personal Access Token to capture Figma
          evidence.
        </p>
        <p className="figma-verification-panel__copy">
          After that you can paste your Figma design directly in the canvas.
        </p>
      </div>

      <div className="figma-verification-panel__link-row">
        <a
          className="figma-verification-panel__link"
          href={FIGMA_TOKEN_HELP_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="figma-token-help-link"
        >
          <span>Get a Figma token</span>
          <span className="figma-verification-panel__link-icon" aria-hidden="true">
            <HugeiconsIcon
              icon={ArrowUpRight03Icon}
              size={10}
              color="currentColor"
              strokeWidth={1.5}
            />
          </span>
        </a>
      </div>

      <form className="figma-verification-panel__form" onSubmit={handleSubmit}>
        <label className="figma-verification-panel__field" htmlFor={inputId}>
          <input
            id={inputId}
            className="figma-verification-panel__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your Figma token here."
            value={token}
            disabled={phase === "checking" || phase === "verified"}
            onChange={(event) => onTokenChange(event.target.value)}
            data-testid="figma-token-input"
            aria-invalid={phase === "error" ? true : undefined}
          />
          {showCheck ? (
            <SmallIconButton
              icon={Add01Icon}
              label="Check Figma token"
              className="figma-verification-panel__check"
              disabled={phase === "checking"}
              onClick={onCheck}
              data-testid="figma-token-check"
            />
          ) : null}
          {showVerified ? (
            <span
              className="figma-verification-panel__verified"
              data-testid="figma-token-verified"
              aria-label="Token verified"
            >
              <HugeiconsIcon
                icon={Tick02Icon}
                size={8}
                color="#ffffff"
                strokeWidth={2}
              />
            </span>
          ) : null}
        </label>

        {phase === "error" && error ? (
          <p
            className="figma-verification-panel__error"
            role="alert"
            data-testid="figma-token-error"
          >
            {error}
          </p>
        ) : null}

        {showEnter ? (
          <button
            type="button"
            className="figma-verification-panel__enter"
            onClick={onEnterCanvas}
            data-testid="figma-enter-canvas"
          >
            Enter Canvas
          </button>
        ) : null}
      </form>
    </SquircleChrome>
  );
}

export function tokenPanelPhaseFromValue(
  token: string,
  opts: { verifying: boolean; verified: boolean; error: string | null }
): FigmaVerificationPanelPhase {
  if (opts.verified) return "verified";
  if (opts.verifying) return "checking";
  if (opts.error) return "error";
  if (token.trim().length > 0) return "ready";
  return "empty";
}

/** Controlled container used by the Workbench gate overlay. */
export function FigmaVerificationPanelController({
  onVerifiedEnter,
  connect
}: {
  onVerifiedEnter: () => void;
  connect: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [token, setToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phase = tokenPanelPhaseFromValue(token, {
    verifying,
    verified,
    error
  });

  async function handleCheck() {
    const trimmed = token.trim();
    if (!trimmed || verifying || verified) return;
    setVerifying(true);
    setError(null);
    const result = await connect(trimmed);
    setVerifying(false);
    if (!result.ok) {
      // Never echo the token in the error string.
      setError(
        result.error === "invalid_token"
          ? "That token could not be verified. Check it and try again."
          : "Could not connect to Figma. Try again."
      );
      return;
    }
    setVerified(true);
  }

  return (
    <FigmaVerificationPanel
      phase={phase}
      token={token}
      error={error}
      onTokenChange={(value) => {
        setToken(value);
        setError(null);
        setVerified(false);
      }}
      onCheck={() => {
        void handleCheck();
      }}
      onEnterCanvas={onVerifiedEnter}
    />
  );
}
