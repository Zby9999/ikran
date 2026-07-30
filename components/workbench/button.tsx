import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Shared press + focus behavior for Ikran workbench controls.
 * Visual surfaces stay in globals.css; this layer owns interaction feedback.
 */
const workbenchPressable =
  "transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-100 ease-[var(--motion-ease-out)] select-none outline-none focus-visible:outline-2 focus-visible:outline-[var(--blue)] focus-visible:outline-offset-2 disabled:cursor-not-allowed active:enabled:scale-[0.99] active:enabled:translate-y-px";

const workbenchButtonVariants = cva(workbenchPressable, {
  variants: {
    variant: {
      setupRow:
        "step-row step-row-button min-h-10 w-full appearance-none border-0 bg-transparent p-0 text-left font-inherit text-inherit shadow-none hover:bg-transparent",
      setupRowSettled:
        "step-row step-row--settled step-row-button min-h-10 w-full appearance-none border-0 bg-transparent p-0 text-left font-inherit text-inherit shadow-none hover:bg-transparent",
      agentChip: "agent-option",
      primaryAction: "action",
      subtlePill: "use-folder-directly"
    }
  },
  defaultVariants: {
    variant: "setupRow"
  }
});

const WorkbenchButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof workbenchButtonVariants> & {
      asChild?: boolean;
    }
>(function WorkbenchButton(
  { className, variant, asChild = false, type = "button", ...props },
  ref
) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      ref={ref}
      data-slot="workbench-button"
      data-variant={variant}
      className={cn(workbenchButtonVariants({ variant, className }))}
      type={asChild ? undefined : type}
      {...props}
    />
  );
});

WorkbenchButton.displayName = "WorkbenchButton";

export { WorkbenchButton, workbenchButtonVariants };
