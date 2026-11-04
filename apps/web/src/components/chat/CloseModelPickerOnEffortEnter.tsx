import { type ReactNode, useEffect, useRef } from "react";

export function CloseModelPickerOnEffortEnter({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for capture keydown on the popup to close the picker on Enter when the model has no effort levels
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const popup =
      root.closest<HTMLElement>("[data-model-picker-effort]")?.parentElement ??
      root.closest<HTMLElement>('[role="dialog"], [role="menu"]') ??
      root.parentElement;
    if (!popup) return;

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      // Ignore effort level items
      if (target.closest("[data-effort-level]")) {
        return;
      }

      // Do NOT trigger on sidebar provider buttons (keyboard navigation ArrowLeft / Shift+Tab)
      if (target.closest("[data-model-picker-sidebar], [data-model-picker-provider]")) {
        return;
      }

      // Do NOT trigger on legacy-section headers or toggle rows
      if (target.closest("[aria-expanded], [data-model-picker-legacy]")) {
        return;
      }

      // ONLY trigger when the target is:
      // 1) the search input (event.target instanceof HTMLInputElement or input[type="text"] inside the picker), OR
      // 2) a model option button / item (target.closest('[role="option"]') or inside [data-model-picker-content])
      const isSearchInput =
        target instanceof HTMLInputElement ||
        target.matches('input[type="text"], input[type="search"], input:not([type])');

      if (isSearchInput) {
        // When pressing Enter in search with 0 matching models, it does not close the picker
        // (check if an active or selected model exists, or if there are options present)
        const hasMatchingModel =
          popup.querySelector('[role="option"]:not([aria-expanded])') != null ||
          popup.querySelector("[data-highlighted]") != null ||
          popup.querySelector('[aria-selected="true"]') != null;
        if (!hasMatchingModel) {
          return;
        }
      } else {
        const isModelOption =
          (target.closest('[role="option"]') != null ||
            target.closest("[data-model-picker-content]") != null) &&
          !target.closest("[data-model-picker-sidebar], [data-model-picker-provider]") &&
          !target.closest("[aria-expanded], [data-model-picker-legacy]");

        if (!isModelOption) {
          return;
        }
      }

      window.requestAnimationFrame(() => {
        if (!root.isConnected) return;
        const effortColumn = popup.querySelector("[data-model-picker-effort]") ?? root;
        const hasEffortLevels =
          effortColumn.querySelector("[data-effort-level]:not(:disabled)") != null;
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
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !(target instanceof Element) ||
          !target.closest("[data-effort-level]:not(:disabled)")
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
