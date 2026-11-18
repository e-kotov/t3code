import { useGT, useMessages, T } from "gt-react";
import { findRun } from "./deviceCommands.logic";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { describeRunOutcome } from "./deviceCommandsFormat";
import {
  runDeviceCommand,
  closeDeviceCommandOutput,
  stopDeviceCommandRun,
  useDeviceCommandsStore,
} from "./deviceCommandsStore";

/** Live output of one run; it keeps updating while the command runs. */
export function DeviceCommandOutputDialog() {
  const gt = useGT();
  const m = useMessages();
  const run = useDeviceCommandsStore((state) => findRun(state.runsByCommandId, state.outputRunId));
  const command = useDeviceCommandsStore((state) =>
    state.commands.find((item) => item.id === run?.commandId),
  );
  return (
    <Dialog
      open={run !== null}
      onOpenChange={(open) => {
        if (!open) closeDeviceCommandOutput();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{run?.commandName ?? gt("Command")}</DialogTitle>
          <DialogDescription>
            {run ? describeRunOutcome(run, m) : null}
            {run?.error ? ` · ${run.error}` : null}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {run?.outputTruncated ? (
            <p className="mb-2 text-xs text-muted-foreground">
              <T>Showing the latest output only.</T>
            </p>
          ) : null}
          <pre className="max-h-[60vh] min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs select-text">
            {run?.output || gt("No output yet.")}
          </pre>
        </DialogPanel>
        <DialogFooter variant="bare">
          {run?.status === "running" ? (
            <Button
              type="button"
              variant="destructive-outline"
              className="mr-auto"
              onClick={() => void stopDeviceCommandRun(run.runId)}
            >
              <T>Stop</T>
            </Button>
          ) : null}
          {command && run?.status !== "running" ? (
            <Button type="button" onClick={() => void runDeviceCommand(command)}>
              <T>Run again</T>
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={closeDeviceCommandOutput}>
            <T>Close</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
