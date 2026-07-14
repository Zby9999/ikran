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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const FIGMA_TOKEN_HELP_URL =
  "https://developers.figma.com/docs/rest-api/personal-access-tokens/";

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
 * Figma Connection Gate panel (Figma 327:465 / composition 305:328).
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
  const showError = phase === "error" && Boolean(error);
  const showEnter = phase === "verified";
  // Asymmetric right radius is only for the trailing + button; error/verified stay 8px.
  const tokenEntered = showCheck || showVerified || showError;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase === "ready") onCheck();
    else if (phase === "verified") onEnterCanvas();
  }

  return (
    <SquircleChrome
      className="figma-verification-panel"
      surfaceClassName="figma-verification-panel__body"
      cornerRadius={16}
      surfaceProps={{
        "data-testid": "figma-verification-panel",
        "data-phase": phase
      }}
    >
      <div className="figma-verification-panel__brand">
        <div className="figma-verification-panel__logo" aria-hidden="true">
          <FigmaLogoMark />
        </div>
        <p className="figma-verification-panel__title">Connect Figma</p>
      </div>

      <div className="figma-verification-panel__copy-group">
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
          <span className="figma-verification-panel__link-inner">
            <span>Get a Figma token</span>
            <span className="figma-verification-panel__link-icon" aria-hidden="true">
              <HugeiconsIcon
                icon={ArrowUpRight03Icon}
                size={10}
                color="currentColor"
                strokeWidth={1.5}
              />
            </span>
          </span>
        </a>
      </div>

      <form className="figma-verification-panel__form" onSubmit={handleSubmit}>
        <div className="figma-verification-panel__field">
          <label className="sr-only" htmlFor={inputId}>
            Figma Personal Access Token
          </label>
          <Input
            id={inputId}
            className={cn(
              "figma-verification-panel__input",
              "h-8 border bg-white py-1 text-[13px] tracking-[-0.39px] shadow-none md:text-[13px]",
              "border-[rgba(0,0,0,0.1)] placeholder:text-[#999999]",
              "focus-visible:border-[rgba(0,0,0,0.1)] focus-visible:ring-1 focus-visible:ring-[#731b73]/25",
              "disabled:cursor-default disabled:bg-white disabled:opacity-100",
              "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20",
              tokenEntered
                ? cn(
                    "pl-[10px]",
                    showCheck && "figma-verification-panel__input--entered",
                    showError ? "pr-[88px]" : "pr-8"
                  )
                : "px-[10px]"
            )}
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
              loading={phase === "checking"}
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
          {showError ? (
            <span
              className="figma-verification-panel__error-inline"
              role="alert"
              data-testid="figma-token-error"
            >
              {error}
            </span>
          ) : null}
        </div>
      </form>

      <div
        className={cn(
          "figma-verification-panel__enter-slot",
          showEnter && "figma-verification-panel__enter-slot--open"
        )}
      >
        <div className="figma-verification-panel__enter-slot-inner">
          {showEnter ? (
            <Button
              type="button"
              variant="ghost"
              className="figma-verification-panel__enter"
              onClick={onEnterCanvas}
              data-testid="figma-enter-canvas"
            >
              Enter Canvas
            </Button>
          ) : null}
        </div>
      </div>
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
        result.error === "invalid_token" ? "Invalid token" : "Couldn't connect"
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
