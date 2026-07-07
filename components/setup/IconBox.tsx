import { CheckIcon as PhosphorCheckIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

type IconTone = "gray" | "pink" | "blue" | "purple";

export function IconBox({
  children,
  tone = "gray"
}: {
  children: ReactNode;
  tone?: IconTone;
}) {
  return (
    <span className={`icon-box icon-box--${tone}`} aria-hidden="true">
      {children}
    </span>
  );
}

export function SettledCheckIcon() {
  return (
    <span className="settled-check" aria-hidden="true">
      <PhosphorCheckIcon size={8} weight="bold" />
    </span>
  );
}

/** @deprecated Use SettledCheckIcon on the right; keep the original icon on the left. */
export function CompleteCheckIcon() {
  return (
    <span className="check" aria-hidden="true">
      <PhosphorCheckIcon size={14} weight="regular" />
    </span>
  );
}
