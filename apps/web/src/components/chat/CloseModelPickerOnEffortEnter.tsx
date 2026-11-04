import { type ReactNode, useEffect, useRef } from "react";

export function CloseModelPickerOnEffortEnter({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const popup =
      root.closest<HTMLElement>("[data-model-picker-effort]")?.parentElement ??
      root.closest<HTMLElement>("[role=\"dialog\"], [role=\"menu\"]") ??
      root.parentElement;
    if (!popup) return;

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      window.requestAnimationFrame(() => {
        const effortColumn = popup.querySelector("[data-model-picker-effort]");
        const hasEffortLevels =
          effortColumn?.querySelector("[data-effort-level]:not(:disabled)") != null;
        if (!hasEffortLevels) {
          onClose();
        }
      });
    };

    popup.addEventListener("keydown", handleKeyDownCapture, { capture: true });
    return () => {
      popup.removeEventListener("keydown", handleKeyDownCapture, { capture: true });
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="contents"
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.key !== "Enter" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !(target instanceof Element) ||
          !target.matches("[data-effort-level]:not(:disabled)")
        ) {
          return;
        }

        window.requestAnimationFrame(onClose);
      }}
    >
      {children}
    </div>
  );
}

export function closeModelPickerOnEffortEnter(props: {
  effortColumn?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return {
    effortColumn:
      props.effortColumn === undefined ? undefined : (
        <CloseModelPickerOnEffortEnter onClose={() => props.onOpenChange?.(false)}>
          {props.effortColumn}
        </CloseModelPickerOnEffortEnter>
      ),
  };
}
