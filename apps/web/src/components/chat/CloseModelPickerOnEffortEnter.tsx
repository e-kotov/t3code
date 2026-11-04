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

      const isSearchInput =
        target instanceof HTMLInputElement ||
        target.matches('input[type="text"], input[type="search"], input:not([type])');

      if (isSearchInput) {
        const highlighted = popup.querySelector<HTMLElement>('[role="option"][data-highlighted]');
        if (!highlighted || !highlighted.closest("[data-model-picker-content]")) {
          return;
        }
        if (
          highlighted.hasAttribute("aria-expanded") ||
          highlighted.closest("[aria-expanded], [data-model-picker-legacy]") != null
        ) {
          return;
        }
        if (
          highlighted.hasAttribute("data-disabled") ||
          highlighted.getAttribute("aria-disabled") === "true"
        ) {
          return;
        }
        if (
          highlighted.matches('button[data-favorite], button[aria-label*="favorite" i]') ||
          highlighted.closest('button[data-favorite], button[aria-label*="favorite" i]') != null
        ) {
          return;
        }
      } else {
        if (target.closest("[aria-expanded], [data-model-picker-legacy]")) {
          return;
        }

        if (target.closest('button[data-favorite], button[aria-label*="favorite" i]')) {
          return;
        }

        const option = target.closest('[role="option"]');
        if (!option || !option.closest("[data-model-picker-content]")) {
          return;
        }

        if (
          option.hasAttribute("data-disabled") ||
          option.getAttribute("aria-disabled") === "true"
        ) {
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
