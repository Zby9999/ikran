"use client";

import { useState } from "react";
import { ShutDownIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { requestRuntimeShutdown } from "@/lib/runtime/request-runtime-shutdown";

export function RuntimeShutdownControl({ session }: { session: string }) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(false);
  const shutdown = async () => {
    setStopping(true);
    setError(false);
    try {
      await requestRuntimeShutdown(session);
    } catch {
      setStopping(false);
      setError(true);
    }
  };

  return (
    <>
      <Dialog onOpenChange={(open) => { if (!open) setError(false); }}>
        <DialogTrigger asChild>
          <button className="seed-workbench__shutdown" type="button" aria-label="Shutdown Ikran Runtime" data-testid="runtime-shutdown">
            <HugeiconsIcon icon={ShutDownIcon} size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </DialogTrigger>
        <DialogContent className="seed-workbench__shutdown-prompt" data-testid="runtime-shutdown-confirmation">
          <DialogTitle className="seed-workbench__shutdown-question">
            {error ? "Unable to shut down ikran. Try again?" : "Are you sure you want to shut down ikran?"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Confirming closes the local Ikran Runtime and its MCP connection.
          </DialogDescription>
          <button
            className="seed-workbench__shutdown-yes"
            type="button"
            disabled={stopping}
            onClick={() => void shutdown()}
          >
            {stopping ? "…" : "Yes"}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
